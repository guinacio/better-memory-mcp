#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Define memory file path using environment variable with fallback
export const defaultMemoryPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'memory.jsonl');

// Handle backward compatibility: migrate memory.json to memory.jsonl if needed
export async function ensureMemoryFilePath(): Promise<string> {
  if (process.env.MEMORY_FILE_PATH) {
    // Custom path provided, use it as-is (with absolute path resolution)
    return path.isAbsolute(process.env.MEMORY_FILE_PATH)
      ? process.env.MEMORY_FILE_PATH
      : path.join(path.dirname(fileURLToPath(import.meta.url)), process.env.MEMORY_FILE_PATH);
  }
  
  // No custom path set, check for backward compatibility migration
  const oldMemoryPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'memory.json');
  const newMemoryPath = defaultMemoryPath;
  
  try {
    // Check if old file exists and new file doesn't
    await fs.access(oldMemoryPath);
    try {
      await fs.access(newMemoryPath);
      // Both files exist, use new one (no migration needed)
      return newMemoryPath;
    } catch {
      // Old file exists, new file doesn't - migrate
      console.error('DETECTED: Found legacy memory.json file, migrating to memory.jsonl for JSONL format compatibility');
      await fs.rename(oldMemoryPath, newMemoryPath);
      console.error('COMPLETED: Successfully migrated memory.json to memory.jsonl');
      return newMemoryPath;
    }
  } catch {
    // Old file doesn't exist, use new path
    return newMemoryPath;
  }
}

// Initialize memory file path (will be set during startup)
let MEMORY_FILE_PATH: string;

// We are storing our memory using entities, relations, and observations in a graph structure
export interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

export interface Relation {
  from: string;
  to: string;
  relationType: string;
}

export interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
  [key: string]: unknown;
}

// Search options for advanced querying
export interface SearchOptions {
  includeNeighbors?: boolean;  // Include 1-hop connected entities
  fuzzy?: boolean;             // Enable fuzzy matching for typo tolerance
  limit?: number;              // Maximum number of results
  [key: string]: unknown;
}

// Search result with optional relevance scores
export interface SearchResult extends KnowledgeGraph {
  scores?: { name: string; score: number }[];
  [key: string]: unknown;
}

// Parsed query structure for boolean operators
interface ParsedQuery {
  required: string[];   // +term (must be present)
  optional: string[];   // plain term (OR logic)
  excluded: string[];   // -term (must NOT be present)
  phrases: string[];    // "exact phrase"
}

// Field-specific query structure
interface FieldQuery {
  name?: ParsedQuery;
  type?: ParsedQuery;
  obs?: ParsedQuery;
  all?: ParsedQuery;  // Applies to all fields
}

// Neighbor result structure
export interface NeighborResult {
  entity: Entity;
  relation: Relation;
  direction: 'incoming' | 'outgoing';
  [key: string]: unknown;
}

// Path result structure
export interface PathResult {
  path: Entity[];
  relations: Relation[];
  length: number;
  [key: string]: unknown;
}

// Observation match result structure
export interface ObservationMatch {
  entityName: string;
  entityType: string;
  observation: string;
  score: number;
}

// Observation search options
export interface ObservationSearchOptions {
  limit?: number;
  includeEntity?: boolean;
  fuzzy?: boolean;
}

// Observation search result
export interface ObservationSearchResult {
  matches: ObservationMatch[];
  entities?: Entity[];  // Only populated if includeEntity is true
  [key: string]: unknown;
}

// The KnowledgeGraphManager class contains all operations to interact with the knowledge graph
export class KnowledgeGraphManager {
  constructor(private memoryFilePath: string) {}

  // ==================== Search Helper Methods ====================

  /**
   * Tokenize a string into lowercase words
   */
  private tokenize(text: string): string[] {
    return text.toLowerCase().split(/\s+/).filter(token => token.length > 0);
  }

  /**
   * Parse a query string into structured components with boolean operators
   * Syntax: +required -excluded "exact phrase" optional
   */
  private parseQuery(query: string): ParsedQuery {
    const result: ParsedQuery = { required: [], optional: [], excluded: [], phrases: [] };

    // Extract quoted phrases first
    const phraseRegex = /"([^"]+)"/g;
    let phraseMatch;
    let remainingQuery = query;
    while ((phraseMatch = phraseRegex.exec(query)) !== null) {
      result.phrases.push(phraseMatch[1].toLowerCase());
      remainingQuery = remainingQuery.replace(phraseMatch[0], ' ');
    }

    // Parse remaining tokens
    const tokens = remainingQuery.split(/\s+/).filter(t => t.length > 0);
    for (const token of tokens) {
      if (token.startsWith('+') && token.length > 1) {
        result.required.push(token.slice(1).toLowerCase());
      } else if (token.startsWith('-') && token.length > 1) {
        result.excluded.push(token.slice(1).toLowerCase());
      } else if (!token.startsWith('+') && !token.startsWith('-')) {
        result.optional.push(token.toLowerCase());
      }
    }

    return result;
  }

  /**
   * Parse a query with field-specific prefixes (name:, type:, obs:)
   */
  private parseFieldQuery(query: string): FieldQuery {
    const fieldQuery: FieldQuery = {};

    // Match field:value patterns, handling quoted values
    const fieldRegex = /(name|type|obs):(?:"([^"]+)"|(\S+))/gi;
    let match;
    let remainingQuery = query;

    while ((match = fieldRegex.exec(query)) !== null) {
      const field = match[1].toLowerCase() as 'name' | 'type' | 'obs';
      const value = match[2] || match[3]; // Quoted or unquoted value
      fieldQuery[field] = this.parseQuery(value);
      remainingQuery = remainingQuery.replace(match[0], ' ');
    }

    // Remaining query applies to all fields
    remainingQuery = remainingQuery.trim();
    if (remainingQuery) {
      fieldQuery.all = this.parseQuery(remainingQuery);
    }

    return fieldQuery;
  }

  /**
   * Check if text matches a parsed query
   */
  private matchesParsedQuery(text: string, parsed: ParsedQuery): boolean {
    const lowerText = text.toLowerCase();

    // All required terms must match
    if (parsed.required.length > 0) {
      if (parsed.required.some(term => !lowerText.includes(term))) return false;
    }

    // No excluded terms may match
    if (parsed.excluded.some(term => lowerText.includes(term))) return false;

    // All phrases must match exactly
    if (parsed.phrases.some(phrase => !lowerText.includes(phrase))) return false;

    // At least one optional term must match (if any exist and no required terms)
    if (parsed.optional.length > 0 && parsed.required.length === 0 && parsed.phrases.length === 0) {
      if (!parsed.optional.some(term => lowerText.includes(term))) return false;
    }

    return true;
  }

  /**
   * Check if an entity matches a field-specific query
   */
  private entityMatchesFieldQuery(entity: Entity, fieldQuery: FieldQuery): boolean {
    // Check field-specific queries
    if (fieldQuery.name && !this.matchesParsedQuery(entity.name, fieldQuery.name)) return false;
    if (fieldQuery.type && !this.matchesParsedQuery(entity.entityType, fieldQuery.type)) return false;
    if (fieldQuery.obs) {
      const allObs = entity.observations.join(' ');
      if (!this.matchesParsedQuery(allObs, fieldQuery.obs)) return false;
    }

    // Check "all fields" query
    if (fieldQuery.all) {
      const allText = `${entity.name} ${entity.entityType} ${entity.observations.join(' ')}`;
      if (!this.matchesParsedQuery(allText, fieldQuery.all)) return false;
    }

    return true;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= a.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= b.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // deletion
          matrix[i][j - 1] + 1,      // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    return matrix[a.length][b.length];
  }

  /**
   * Check if text fuzzy-matches a query term
   */
  private fuzzyMatch(text: string, query: string, maxDistance?: number): boolean {
    const words = text.toLowerCase().split(/\s+/);
    const queryLower = query.toLowerCase();

    // Calculate max distance based on query length if not provided
    const distance = maxDistance ?? Math.max(1, Math.floor(queryLower.length / 4));

    return words.some(word => {
      // Exact substring match always wins
      if (word.includes(queryLower) || queryLower.includes(word)) return true;
      // Fuzzy match for similar-length words
      if (Math.abs(word.length - queryLower.length) <= distance) {
        return this.levenshteinDistance(word, queryLower) <= distance;
      }
      return false;
    });
  }

  /**
   * Score an entity's relevance to a search query
   */
  private scoreEntity(entity: Entity, query: string, fuzzy: boolean = false): number {
    const queryLower = query.toLowerCase();
    const tokens = this.tokenize(query);
    let score = 0;

    // Name matches are highest value
    const nameLower = entity.name.toLowerCase();
    if (nameLower === queryLower) {
      score += 100;  // Exact name match
    } else if (nameLower.includes(queryLower)) {
      score += 50;   // Partial name match (query is substring of name)
    } else if (tokens.some(t => nameLower.includes(t))) {
      score += 30;   // Token match in name
    } else if (fuzzy && this.fuzzyMatch(entity.name, query)) {
      score += 15;   // Fuzzy name match
    }

    // Type matches
    const typeLower = entity.entityType.toLowerCase();
    if (typeLower === queryLower) {
      score += 40;   // Exact type match
    } else if (tokens.some(t => typeLower.includes(t))) {
      score += 20;   // Token match in type
    }

    // Observation matches (cumulative)
    for (const obs of entity.observations) {
      const obsLower = obs.toLowerCase();
      if (obsLower.includes(queryLower)) {
        score += 15;  // Full query match in observation
      } else if (tokens.some(t => obsLower.includes(t))) {
        score += 10;  // Token match in observation
      } else if (fuzzy && this.fuzzyMatch(obs, query)) {
        score += 5;   // Fuzzy match in observation
      }
    }

    return score;
  }

  // ==================== Core Data Methods ====================

  private async loadGraph(): Promise<KnowledgeGraph> {
    try {
      const data = await fs.readFile(this.memoryFilePath, "utf-8");
      const lines = data.split("\n").filter(line => line.trim() !== "");
      return lines.reduce((graph: KnowledgeGraph, line) => {
        const item = JSON.parse(line);
        if (item.type === "entity") {
          // Strip internal 'type' field to match Entity interface
          const { type, ...entity } = item;
          graph.entities.push(entity as Entity);
        }
        if (item.type === "relation") {
          // Strip internal 'type' field to match Relation interface
          const { type, ...relation } = item;
          graph.relations.push(relation as Relation);
        }
        return graph;
      }, { entities: [], relations: [] });
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as any).code === "ENOENT") {
        return { entities: [], relations: [] };
      }
      throw error;
    }
  }

  private async saveGraph(graph: KnowledgeGraph): Promise<void> {
    const lines = [
      ...graph.entities.map(e => JSON.stringify({
        type: "entity",
        name: e.name,
        entityType: e.entityType,
        observations: e.observations
      })),
      ...graph.relations.map(r => JSON.stringify({
        type: "relation",
        from: r.from,
        to: r.to,
        relationType: r.relationType
      })),
    ];
    await fs.writeFile(this.memoryFilePath, lines.join("\n"));
  }

  async createEntities(entities: Entity[]): Promise<Entity[]> {
    const graph = await this.loadGraph();
    const newEntities = entities.filter(e => !graph.entities.some(existingEntity => existingEntity.name === e.name));
    graph.entities.push(...newEntities);
    await this.saveGraph(graph);
    return newEntities;
  }

  async createRelations(relations: Relation[]): Promise<Relation[]> {
    const graph = await this.loadGraph();
    const newRelations = relations.filter(r => !graph.relations.some(existingRelation => 
      existingRelation.from === r.from && 
      existingRelation.to === r.to && 
      existingRelation.relationType === r.relationType
    ));
    graph.relations.push(...newRelations);
    await this.saveGraph(graph);
    return newRelations;
  }

  async addObservations(observations: { entityName: string; contents: string[] }[]): Promise<{ entityName: string; addedObservations: string[] }[]> {
    const graph = await this.loadGraph();
    const results = observations.map(o => {
      const entity = graph.entities.find(e => e.name === o.entityName);
      if (!entity) {
        throw new Error(`Entity with name ${o.entityName} not found`);
      }
      const newObservations = o.contents.filter(content => !entity.observations.includes(content));
      entity.observations.push(...newObservations);
      return { entityName: o.entityName, addedObservations: newObservations };
    });
    await this.saveGraph(graph);
    return results;
  }

  async deleteEntities(entityNames: string[]): Promise<void> {
    const graph = await this.loadGraph();
    graph.entities = graph.entities.filter(e => !entityNames.includes(e.name));
    graph.relations = graph.relations.filter(r => !entityNames.includes(r.from) && !entityNames.includes(r.to));
    await this.saveGraph(graph);
  }

  async deleteObservations(deletions: { entityName: string; observations: string[] }[]): Promise<void> {
    const graph = await this.loadGraph();
    deletions.forEach(d => {
      const entity = graph.entities.find(e => e.name === d.entityName);
      if (entity) {
        entity.observations = entity.observations.filter(o => !d.observations.includes(o));
      }
    });
    await this.saveGraph(graph);
  }

  async deleteRelations(relations: Relation[]): Promise<void> {
    const graph = await this.loadGraph();
    graph.relations = graph.relations.filter(r => !relations.some(delRelation => 
      r.from === delRelation.from && 
      r.to === delRelation.to && 
      r.relationType === delRelation.relationType
    ));
    await this.saveGraph(graph);
  }

  async readGraph(): Promise<KnowledgeGraph> {
    return this.loadGraph();
  }

  /**
   * Advanced search with boolean operators, field prefixes, fuzzy matching, and relevance scoring.
   *
   * Query Syntax:
   * - Multiple words: OR logic (matches any word)
   * - +term: Required (must be present)
   * - -term: Excluded (must NOT be present)
   * - "phrase": Exact phrase match
   * - name:value: Search only entity names
   * - type:value: Search only entity types
   * - obs:value: Search only observations
   *
   * Examples:
   * - "auth module" - finds entities matching "auth" OR "module"
   * - "+auth +security" - finds entities matching BOTH "auth" AND "security"
   * - "auth -deprecated" - finds "auth" but excludes "deprecated"
   * - "name:AuthService type:Module" - finds AuthService of type Module
   */
  async searchNodes(query: string, options: SearchOptions = {}): Promise<SearchResult> {
    const graph = await this.loadGraph();
    const { includeNeighbors = false, fuzzy = false, limit } = options;

    // Handle empty query
    if (!query.trim()) {
      return { entities: [], relations: [], scores: [] };
    }

    // Parse the query for field-specific and boolean operators
    const fieldQuery = this.parseFieldQuery(query);

    // Check if query has any parseable content
    const hasFieldQueries = fieldQuery.name || fieldQuery.type || fieldQuery.obs;
    const hasAllQuery = fieldQuery.all && (
      fieldQuery.all.required.length > 0 ||
      fieldQuery.all.optional.length > 0 ||
      fieldQuery.all.phrases.length > 0
    );

    if (!hasFieldQueries && !hasAllQuery) {
      return { entities: [], relations: [], scores: [] };
    }

    // Step 1: Filter entities by query match
    let matchedEntities = graph.entities.filter(entity => {
      // Check field-specific matching
      if (!this.entityMatchesFieldQuery(entity, fieldQuery)) {
        // If standard matching fails and fuzzy is enabled, try fuzzy matching
        if (fuzzy && fieldQuery.all) {
          const allTokens = [
            ...fieldQuery.all.required,
            ...fieldQuery.all.optional,
            ...fieldQuery.all.phrases
          ];
          const allText = `${entity.name} ${entity.entityType} ${entity.observations.join(' ')}`;
          return allTokens.some(token => this.fuzzyMatch(allText, token));
        }
        return false;
      }
      return true;
    });

    // Step 2: Score and sort entities
    const rawQuery = query.replace(/(name|type|obs):\S+/gi, '').trim();
    const scored = matchedEntities.map(entity => ({
      entity,
      score: this.scoreEntity(entity, rawQuery || query, fuzzy)
    })).sort((a, b) => b.score - a.score);

    // Step 3: Apply limit if specified
    const limitedScored = limit ? scored.slice(0, limit) : scored;
    matchedEntities = limitedScored.map(s => s.entity);
    let matchedEntityNames = new Set(matchedEntities.map(e => e.name));

    // Step 4: If includeNeighbors, expand to 1-hop connected entities
    if (includeNeighbors && matchedEntityNames.size > 0) {
      const neighborNames = new Set<string>();
      for (const rel of graph.relations) {
        if (matchedEntityNames.has(rel.from)) {
          neighborNames.add(rel.to);
        }
        if (matchedEntityNames.has(rel.to)) {
          neighborNames.add(rel.from);
        }
      }
      // Add neighbor entities to results
      Array.from(neighborNames).forEach(name => {
        if (!matchedEntityNames.has(name)) {
          const neighborEntity = graph.entities.find(e => e.name === name);
          if (neighborEntity) {
            matchedEntities.push(neighborEntity);
            matchedEntityNames.add(name);
          }
        }
      });
    }

    // Step 5: Get relations - include ALL relations where at least one endpoint is in result set
    const filteredRelations = graph.relations.filter(r =>
      matchedEntityNames.has(r.from) || matchedEntityNames.has(r.to)
    );

    return {
      entities: matchedEntities,
      relations: filteredRelations,
      scores: limitedScored.map(s => ({ name: s.entity.name, score: s.score }))
    };
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph();
    
    // Filter entities
    const filteredEntities = graph.entities.filter(e => names.includes(e.name));
  
    // Create a Set of filtered entity names for quick lookup
    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));
  
    // Filter relations to only include those between filtered entities
    const filteredRelations = graph.relations.filter(r => 
      filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );
  
    const filteredGraph: KnowledgeGraph = {
      entities: filteredEntities,
      relations: filteredRelations,
    };

    return filteredGraph;
  }

  // ==================== Graph Traversal Methods ====================

  /**
   * Get all entities directly connected to a given entity
   */
  async getNeighbors(
    entityName: string,
    options?: { direction?: 'incoming' | 'outgoing' | 'both'; relationType?: string }
  ): Promise<NeighborResult[]> {
    const graph = await this.loadGraph();
    const { direction = 'both', relationType } = options || {};
    const results: NeighborResult[] = [];
    const entityMap = new Map(graph.entities.map(e => [e.name, e]));

    // Check if the source entity exists
    if (!entityMap.has(entityName)) {
      return [];
    }

    for (const rel of graph.relations) {
      if (relationType && rel.relationType !== relationType) continue;

      if ((direction === 'both' || direction === 'outgoing') && rel.from === entityName) {
        const targetEntity = entityMap.get(rel.to);
        if (targetEntity) {
          results.push({ entity: targetEntity, relation: rel, direction: 'outgoing' });
        }
      }

      if ((direction === 'both' || direction === 'incoming') && rel.to === entityName) {
        const sourceEntity = entityMap.get(rel.from);
        if (sourceEntity) {
          results.push({ entity: sourceEntity, relation: rel, direction: 'incoming' });
        }
      }
    }

    return results;
  }

  /**
   * Find shortest path between two entities using BFS
   */
  async findPath(
    fromEntity: string,
    toEntity: string,
    maxDepth: number = 10
  ): Promise<PathResult | null> {
    const graph = await this.loadGraph();
    const entityMap = new Map(graph.entities.map(e => [e.name, e]));

    if (!entityMap.has(fromEntity) || !entityMap.has(toEntity)) {
      return null;
    }

    // Same entity - trivial path
    if (fromEntity === toEntity) {
      return {
        path: [entityMap.get(fromEntity)!],
        relations: [],
        length: 0
      };
    }

    // Build adjacency list (bidirectional for path finding)
    const adjacency = new Map<string, { neighbor: string; relation: Relation }[]>();
    for (const entity of graph.entities) {
      adjacency.set(entity.name, []);
    }
    for (const rel of graph.relations) {
      adjacency.get(rel.from)?.push({ neighbor: rel.to, relation: rel });
      adjacency.get(rel.to)?.push({ neighbor: rel.from, relation: rel });
    }

    // BFS
    const visited = new Set<string>();
    const queue: { name: string; path: string[]; relations: Relation[] }[] = [
      { name: fromEntity, path: [fromEntity], relations: [] }
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.name === toEntity) {
        return {
          path: current.path.map(name => entityMap.get(name)!),
          relations: current.relations,
          length: current.path.length - 1
        };
      }

      if (current.path.length > maxDepth) continue;
      if (visited.has(current.name)) continue;
      visited.add(current.name);

      for (const { neighbor, relation } of adjacency.get(current.name) || []) {
        if (!visited.has(neighbor)) {
          queue.push({
            name: neighbor,
            path: [...current.path, neighbor],
            relations: [...current.relations, relation]
          });
        }
      }
    }

    return null;  // No path found
  }

  /**
   * Extract N-hop neighborhood around seed entities
   */
  async getSubgraph(entityNames: string[], depth: number = 1): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph();
    const entitySet = new Set(entityNames);

    // Expand to N-hop neighbors
    for (let i = 0; i < depth; i++) {
      const newNeighbors = new Set<string>();
      for (const rel of graph.relations) {
        if (entitySet.has(rel.from)) newNeighbors.add(rel.to);
        if (entitySet.has(rel.to)) newNeighbors.add(rel.from);
      }
      Array.from(newNeighbors).forEach(name => {
        entitySet.add(name);
      });
    }

    const filteredEntities = graph.entities.filter(e => entitySet.has(e.name));
    const filteredRelations = graph.relations.filter(r =>
      entitySet.has(r.from) && entitySet.has(r.to)
    );

    return { entities: filteredEntities, relations: filteredRelations };
  }

  // ==================== Filtering Methods ====================

  /**
   * Get all entities of a specific type
   */
  async filterByType(entityType: string): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph();
    const filteredEntities = graph.entities.filter(e =>
      e.entityType.toLowerCase() === entityType.toLowerCase()
    );
    const entityNames = new Set(filteredEntities.map(e => e.name));
    const filteredRelations = graph.relations.filter(r =>
      entityNames.has(r.from) && entityNames.has(r.to)
    );
    return { entities: filteredEntities, relations: filteredRelations };
  }

  /**
   * Filter relations by type, source, or target
   */
  async filterRelations(options: {
    relationType?: string;
    fromEntity?: string;
    toEntity?: string;
  }): Promise<{ relations: Relation[]; entities: Entity[] }> {
    const graph = await this.loadGraph();
    const filteredRelations = graph.relations.filter(r => {
      if (options.relationType && r.relationType.toLowerCase() !== options.relationType.toLowerCase()) return false;
      if (options.fromEntity && r.from !== options.fromEntity) return false;
      if (options.toEntity && r.to !== options.toEntity) return false;
      return true;
    });

    // Get all entities involved in the filtered relations
    const entityNames = new Set<string>();
    for (const rel of filteredRelations) {
      entityNames.add(rel.from);
      entityNames.add(rel.to);
    }
    const entities = graph.entities.filter(e => entityNames.has(e.name));

    return { relations: filteredRelations, entities };
  }

  /**
   * Find entities with observations matching a pattern
   */
  async filterByObservation(pattern: string): Promise<Entity[]> {
    const graph = await this.loadGraph();

    // Common preset patterns
    const presetPatterns: Record<string, RegExp> = {
      'dated': /^\[\d{4}-\d{2}-\d{2}\]/,           // [2025-12-16] observations
      'techdebt': /tech\s*debt|TODO|FIXME|HACK/i,  // Tech debt markers
      'deprecated': /deprecated/i,                   // Deprecated items
      'purpose': /purpose:/i,                        // Purpose statements
      'quirk': /quirk:/i,                            // Quirk notes
    };

    // Use preset pattern if available, otherwise treat as regex
    const regex = presetPatterns[pattern.toLowerCase()] || new RegExp(pattern, 'i');

    return graph.entities.filter(e =>
      e.observations.some(obs => regex.test(obs))
    );
  }

  // ==================== Observation-Level Search ====================

  /**
   * Score an individual observation's relevance to a search query
   */
  private scoreObservation(observation: string, query: string, fuzzy: boolean = false): number {
    const queryLower = query.toLowerCase();
    const obsLower = observation.toLowerCase();
    const tokens = this.tokenize(query);
    let score = 0;

    // Exact query match in observation
    if (obsLower.includes(queryLower)) {
      score += 100;
    }

    // Token matches (cumulative)
    for (const token of tokens) {
      if (obsLower.includes(token)) {
        score += 20;
      } else if (fuzzy && this.fuzzyMatch(observation, token)) {
        score += 10;
      }
    }

    // Bonus for match at start of observation
    if (obsLower.startsWith(queryLower) || tokens.some(t => obsLower.startsWith(t))) {
      score += 15;
    }

    return score;
  }

  /**
   * Search at the observation level, returning individual matching observations
   * with their parent entity context.
   *
   * This is more efficient than search_nodes when you need specific facts
   * rather than entire entities.
   */
  async searchObservations(
    query: string,
    options: ObservationSearchOptions = {}
  ): Promise<ObservationSearchResult> {
    const graph = await this.loadGraph();
    const { limit = 10, includeEntity = false, fuzzy = false } = options;

    // Handle empty query
    if (!query.trim()) {
      return { matches: [] };
    }

    // Parse the query for boolean operators
    const parsed = this.parseQuery(query);

    // Collect all matching observations with scores
    const allMatches: ObservationMatch[] = [];

    for (const entity of graph.entities) {
      for (const observation of entity.observations) {
        // Check if observation matches the query
        if (!this.matchesParsedQuery(observation, parsed)) {
          // Try fuzzy matching if enabled
          if (fuzzy) {
            const allTerms = [...parsed.required, ...parsed.optional, ...parsed.phrases];
            if (!allTerms.some(term => this.fuzzyMatch(observation, term))) {
              continue;
            }
          } else {
            continue;
          }
        }

        // Calculate relevance score
        const rawQuery = query.replace(/[+\-"]/g, ' ').trim();
        const score = this.scoreObservation(observation, rawQuery, fuzzy);

        if (score > 0) {
          allMatches.push({
            entityName: entity.name,
            entityType: entity.entityType,
            observation,
            score
          });
        }
      }
    }

    // Sort by score descending
    allMatches.sort((a, b) => b.score - a.score);

    // Apply limit
    const limitedMatches = allMatches.slice(0, limit);

    // Optionally include full entities
    const result: ObservationSearchResult = { matches: limitedMatches };

    if (includeEntity && limitedMatches.length > 0) {
      const entityNames = new Set(limitedMatches.map(m => m.entityName));
      result.entities = graph.entities.filter(e => entityNames.has(e.name));
    }

    return result;
  }
}

let knowledgeGraphManager: KnowledgeGraphManager;

// Zod schemas for entities and relations
const EntitySchema = z.object({
  name: z.string().describe("The name of the entity"),
  entityType: z.string().describe("The type of the entity"),
  observations: z.array(z.string()).describe("An array of observation contents associated with the entity")
});

const RelationSchema = z.object({
  from: z.string().describe("The name of the entity where the relation starts"),
  to: z.string().describe("The name of the entity where the relation ends"),
  relationType: z.string().describe("The type of the relation")
});

// The server instance and tools exposed to Claude
const server = new McpServer({
  name: "memory-server",
  version: "0.6.3",
});

// Register create_entities tool
server.registerTool(
  "create_entities",
  {
    title: "Create Entities",
    description: "Create multiple new entities in the knowledge graph",
    inputSchema: {
      entities: z.array(EntitySchema)
    },
    outputSchema: {
      entities: z.array(EntitySchema)
    }
  },
  async ({ entities }) => {
    const result = await knowledgeGraphManager.createEntities(entities);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: { entities: result }
    };
  }
);

// Register create_relations tool
server.registerTool(
  "create_relations",
  {
    title: "Create Relations",
    description: "Create multiple new relations between entities in the knowledge graph. Relations should be in active voice",
    inputSchema: {
      relations: z.array(RelationSchema)
    },
    outputSchema: {
      relations: z.array(RelationSchema)
    }
  },
  async ({ relations }) => {
    const result = await knowledgeGraphManager.createRelations(relations);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: { relations: result }
    };
  }
);

// Register add_observations tool
server.registerTool(
  "add_observations",
  {
    title: "Add Observations",
    description: "Add new observations to existing entities in the knowledge graph",
    inputSchema: {
      observations: z.array(z.object({
        entityName: z.string().describe("The name of the entity to add the observations to"),
        contents: z.array(z.string()).describe("An array of observation contents to add")
      }))
    },
    outputSchema: {
      results: z.array(z.object({
        entityName: z.string(),
        addedObservations: z.array(z.string())
      }))
    }
  },
  async ({ observations }) => {
    const result = await knowledgeGraphManager.addObservations(observations);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: { results: result }
    };
  }
);

// Register delete_entities tool
server.registerTool(
  "delete_entities",
  {
    title: "Delete Entities",
    description: "Delete multiple entities and their associated relations from the knowledge graph",
    inputSchema: {
      entityNames: z.array(z.string()).describe("An array of entity names to delete")
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string()
    }
  },
  async ({ entityNames }) => {
    await knowledgeGraphManager.deleteEntities(entityNames);
    return {
      content: [{ type: "text" as const, text: "Entities deleted successfully" }],
      structuredContent: { success: true, message: "Entities deleted successfully" }
    };
  }
);

// Register delete_observations tool
server.registerTool(
  "delete_observations",
  {
    title: "Delete Observations",
    description: "Delete specific observations from entities in the knowledge graph",
    inputSchema: {
      deletions: z.array(z.object({
        entityName: z.string().describe("The name of the entity containing the observations"),
        observations: z.array(z.string()).describe("An array of observations to delete")
      }))
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string()
    }
  },
  async ({ deletions }) => {
    await knowledgeGraphManager.deleteObservations(deletions);
    return {
      content: [{ type: "text" as const, text: "Observations deleted successfully" }],
      structuredContent: { success: true, message: "Observations deleted successfully" }
    };
  }
);

// Register delete_relations tool
server.registerTool(
  "delete_relations",
  {
    title: "Delete Relations",
    description: "Delete multiple relations from the knowledge graph",
    inputSchema: {
      relations: z.array(RelationSchema).describe("An array of relations to delete")
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string()
    }
  },
  async ({ relations }) => {
    await knowledgeGraphManager.deleteRelations(relations);
    return {
      content: [{ type: "text" as const, text: "Relations deleted successfully" }],
      structuredContent: { success: true, message: "Relations deleted successfully" }
    };
  }
);

// Register read_graph tool
server.registerTool(
  "read_graph",
  {
    title: "Read Graph",
    description: "Read the entire knowledge graph",
    inputSchema: {},
    outputSchema: {
      entities: z.array(EntitySchema),
      relations: z.array(RelationSchema)
    }
  },
  async () => {
    const graph = await knowledgeGraphManager.readGraph();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(graph, null, 2) }],
      structuredContent: { ...graph }
    };
  }
);

// Register search_nodes tool (enhanced with advanced query support)
server.registerTool(
  "search_nodes",
  {
    title: "Search Nodes",
    description: `Search for nodes in the knowledge graph with advanced query support.

Use for entity discovery: "what modules exist", "find all services related to auth", "which components handle payments". Returns full entities with all observations. Best when you need complete context about something or don't know what entities exist.

Query Syntax:
- Multiple words: OR logic (matches any word)
- +term: Required (must be present)
- -term: Excluded (must NOT be present)
- "phrase": Exact phrase match
- name:value: Search only entity names
- type:value: Search only entity types
- obs:value: Search only observations

Examples:
- "auth module" - finds entities matching "auth" OR "module"
- "+auth +security" - finds entities matching BOTH "auth" AND "security"
- "auth -deprecated" - finds "auth" but excludes "deprecated"
- "name:AuthService type:Module" - finds AuthService of type Module
- "\"tech debt\"" - finds exact phrase "tech debt"`,
    inputSchema: {
      query: z.string().describe("The search query (supports boolean operators and field prefixes)"),
      includeNeighbors: z.boolean().optional()
        .describe("Include 1-hop connected entities in results (default: false)"),
      fuzzy: z.boolean().optional()
        .describe("Enable fuzzy matching for typo tolerance (default: false)"),
      limit: z.number().optional()
        .describe("Maximum number of results to return")
    },
    outputSchema: {
      entities: z.array(EntitySchema),
      relations: z.array(RelationSchema),
      scores: z.array(z.object({
        name: z.string(),
        score: z.number()
      })).optional()
    }
  },
  async ({ query, includeNeighbors, fuzzy, limit }) => {
    const result = await knowledgeGraphManager.searchNodes(query, { includeNeighbors, fuzzy, limit });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result
    };
  }
);

// Register open_nodes tool
server.registerTool(
  "open_nodes",
  {
    title: "Open Nodes",
    description: "Open specific nodes in the knowledge graph by their names",
    inputSchema: {
      names: z.array(z.string()).describe("An array of entity names to retrieve")
    },
    outputSchema: {
      entities: z.array(EntitySchema),
      relations: z.array(RelationSchema)
    }
  },
  async ({ names }) => {
    const graph = await knowledgeGraphManager.openNodes(names);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(graph, null, 2) }],
      structuredContent: { ...graph }
    };
  }
);

// Register get_neighbors tool
server.registerTool(
  "get_neighbors",
  {
    title: "Get Neighbors",
    description: "Get all entities directly connected to a given entity via relations. Useful for exploring the graph around a known entity.",
    inputSchema: {
      entityName: z.string().describe("The name of the entity to find neighbors for"),
      direction: z.enum(['incoming', 'outgoing', 'both']).optional()
        .describe("Filter by relation direction: incoming (points TO this entity), outgoing (FROM this entity), or both (default)"),
      relationType: z.string().optional()
        .describe("Filter by specific relation type (e.g., 'imports', 'calls')")
    },
    outputSchema: {
      neighbors: z.array(z.object({
        entity: EntitySchema,
        relation: RelationSchema,
        direction: z.enum(['incoming', 'outgoing'])
      }))
    }
  },
  async ({ entityName, direction, relationType }) => {
    const neighbors = await knowledgeGraphManager.getNeighbors(entityName, { direction, relationType });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(neighbors, null, 2) }],
      structuredContent: { neighbors }
    };
  }
);

// Register find_path tool
server.registerTool(
  "find_path",
  {
    title: "Find Path",
    description: "Find the shortest path between two entities in the knowledge graph using breadth-first search. Returns null if no path exists.",
    inputSchema: {
      fromEntity: z.string().describe("The name of the starting entity"),
      toEntity: z.string().describe("The name of the target entity"),
      maxDepth: z.number().optional().describe("Maximum path length to search (default: 10)")
    },
    outputSchema: {
      path: z.array(EntitySchema).nullable(),
      relations: z.array(RelationSchema).nullable(),
      length: z.number().nullable()
    }
  },
  async ({ fromEntity, toEntity, maxDepth }) => {
    const result = await knowledgeGraphManager.findPath(fromEntity, toEntity, maxDepth ?? 10);
    if (result) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    } else {
      return {
        content: [{ type: "text" as const, text: "No path found between the specified entities" }],
        structuredContent: { path: null, relations: null, length: null }
      };
    }
  }
);

// Register get_subgraph tool
server.registerTool(
  "get_subgraph",
  {
    title: "Get Subgraph",
    description: "Extract a subgraph containing the specified entities and their N-hop neighborhood. Useful for understanding the context around multiple related entities.",
    inputSchema: {
      entityNames: z.array(z.string()).describe("Seed entity names to build the subgraph around"),
      depth: z.number().optional().describe("Number of hops to expand from seed entities (default: 1)")
    },
    outputSchema: {
      entities: z.array(EntitySchema),
      relations: z.array(RelationSchema)
    }
  },
  async ({ entityNames, depth }) => {
    const result = await knowledgeGraphManager.getSubgraph(entityNames, depth ?? 1);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result
    };
  }
);

// Register filter_by_type tool
server.registerTool(
  "filter_by_type",
  {
    title: "Filter By Type",
    description: "Get all entities of a specific type (e.g., 'Module', 'Service', 'Pattern', 'Decision'). Returns entities and relations between them.",
    inputSchema: {
      entityType: z.string().describe("The entity type to filter by (case-insensitive)")
    },
    outputSchema: {
      entities: z.array(EntitySchema),
      relations: z.array(RelationSchema)
    }
  },
  async ({ entityType }) => {
    const result = await knowledgeGraphManager.filterByType(entityType);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result
    };
  }
);

// Register filter_relations tool
server.registerTool(
  "filter_relations",
  {
    title: "Filter Relations",
    description: "Filter relations by type, source entity, or target entity. Returns matching relations and their connected entities.",
    inputSchema: {
      relationType: z.string().optional().describe("Filter by relation type (e.g., 'imports', 'calls', 'implements')"),
      fromEntity: z.string().optional().describe("Filter by source entity name"),
      toEntity: z.string().optional().describe("Filter by target entity name")
    },
    outputSchema: {
      relations: z.array(RelationSchema),
      entities: z.array(EntitySchema)
    }
  },
  async ({ relationType, fromEntity, toEntity }) => {
    const result = await knowledgeGraphManager.filterRelations({ relationType, fromEntity, toEntity });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result
    };
  }
);

// Register filter_observations tool
server.registerTool(
  "filter_observations",
  {
    title: "Filter By Observation Pattern",
    description: `Find entities with observations matching a pattern. Supports preset patterns and custom regex.

Preset patterns:
- "dated" - Observations starting with [YYYY-MM-DD]
- "techdebt" - Observations containing tech debt markers (TODO, FIXME, HACK)
- "deprecated" - Observations mentioning deprecated
- "purpose" - Observations containing "Purpose:"
- "quirk" - Observations containing "Quirk:"

Or provide a custom regex pattern.`,
    inputSchema: {
      pattern: z.string().describe("Pattern name (dated, techdebt, deprecated, purpose, quirk) or a custom regex")
    },
    outputSchema: {
      entities: z.array(EntitySchema)
    }
  },
  async ({ pattern }) => {
    const entities = await knowledgeGraphManager.filterByObservation(pattern);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ entities }, null, 2) }],
      structuredContent: { entities }
    };
  }
);

// Register search_observations tool
server.registerTool(
  "search_observations",
  {
    title: "Search Observations",
    description: `Search at the observation level, returning individual matching observations with their parent entity context.

Use for fact-finding: "when was X deprecated", "what's the status of Y", "why did we choose Z". Returns individual observations without entity bloat. Best when you need specific information buried within large entities, or when searching across a codebase for scattered implementation notes.

Query Syntax (same as search_nodes):
- Multiple words: OR logic (matches any word)
- +term: Required (must be present)
- -term: Excluded (must NOT be present)
- "phrase": Exact phrase match

Examples:
- "auth security" - finds observations mentioning auth OR security
- "+deprecated +2024" - finds observations with BOTH terms
- "TODO -completed" - finds TODO mentions excluding completed ones`,
    inputSchema: {
      query: z.string().describe("The search query (supports boolean operators)"),
      limit: z.number().optional()
        .describe("Maximum number of observations to return (default: 10)"),
      includeEntity: z.boolean().optional()
        .describe("Include full parent entities in response (default: false)"),
      fuzzy: z.boolean().optional()
        .describe("Enable fuzzy matching for typo tolerance (default: false)")
    },
    outputSchema: {
      matches: z.array(z.object({
        entityName: z.string(),
        entityType: z.string(),
        observation: z.string(),
        score: z.number()
      })),
      entities: z.array(EntitySchema).optional()
    }
  },
  async ({ query, limit, includeEntity, fuzzy }) => {
    const result = await knowledgeGraphManager.searchObservations(query, { limit, includeEntity, fuzzy });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result
    };
  }
);

async function main() {
  // Initialize memory file path with backward compatibility
  MEMORY_FILE_PATH = await ensureMemoryFilePath();

  // Initialize knowledge graph manager with the memory file path
  knowledgeGraphManager = new KnowledgeGraphManager(MEMORY_FILE_PATH);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Knowledge Graph MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
