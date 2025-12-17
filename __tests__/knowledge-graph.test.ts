import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { KnowledgeGraphManager, Entity, Relation, KnowledgeGraph } from '../index.js';

describe('KnowledgeGraphManager', () => {
  let manager: KnowledgeGraphManager;
  let testFilePath: string;

  beforeEach(async () => {
    // Create a temporary test file path
    testFilePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      `test-memory-${Date.now()}.jsonl`
    );
    manager = new KnowledgeGraphManager(testFilePath);
  });

  afterEach(async () => {
    // Clean up test file
    try {
      await fs.unlink(testFilePath);
    } catch (error) {
      // Ignore errors if file doesn't exist
    }
  });

  describe('createEntities', () => {
    it('should create new entities', async () => {
      const entities: Entity[] = [
        { name: 'Alice', entityType: 'person', observations: ['works at Acme Corp'] },
        { name: 'Bob', entityType: 'person', observations: ['likes programming'] },
      ];

      const newEntities = await manager.createEntities(entities);
      expect(newEntities).toHaveLength(2);
      expect(newEntities).toEqual(entities);

      const graph = await manager.readGraph();
      expect(graph.entities).toHaveLength(2);
    });

    it('should not create duplicate entities', async () => {
      const entities: Entity[] = [
        { name: 'Alice', entityType: 'person', observations: ['works at Acme Corp'] },
      ];

      await manager.createEntities(entities);
      const newEntities = await manager.createEntities(entities);

      expect(newEntities).toHaveLength(0);

      const graph = await manager.readGraph();
      expect(graph.entities).toHaveLength(1);
    });

    it('should handle empty entity arrays', async () => {
      const newEntities = await manager.createEntities([]);
      expect(newEntities).toHaveLength(0);
    });
  });

  describe('createRelations', () => {
    it('should create new relations', async () => {
      await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: [] },
        { name: 'Bob', entityType: 'person', observations: [] },
      ]);

      const relations: Relation[] = [
        { from: 'Alice', to: 'Bob', relationType: 'knows' },
      ];

      const newRelations = await manager.createRelations(relations);
      expect(newRelations).toHaveLength(1);
      expect(newRelations).toEqual(relations);

      const graph = await manager.readGraph();
      expect(graph.relations).toHaveLength(1);
    });

    it('should not create duplicate relations', async () => {
      await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: [] },
        { name: 'Bob', entityType: 'person', observations: [] },
      ]);

      const relations: Relation[] = [
        { from: 'Alice', to: 'Bob', relationType: 'knows' },
      ];

      await manager.createRelations(relations);
      const newRelations = await manager.createRelations(relations);

      expect(newRelations).toHaveLength(0);

      const graph = await manager.readGraph();
      expect(graph.relations).toHaveLength(1);
    });

    it('should handle empty relation arrays', async () => {
      const newRelations = await manager.createRelations([]);
      expect(newRelations).toHaveLength(0);
    });
  });

  describe('addObservations', () => {
    it('should add observations to existing entities', async () => {
      await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: ['works at Acme Corp'] },
      ]);

      const results = await manager.addObservations([
        { entityName: 'Alice', contents: ['likes coffee', 'has a dog'] },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].entityName).toBe('Alice');
      expect(results[0].addedObservations).toHaveLength(2);

      const graph = await manager.readGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice?.observations).toHaveLength(3);
    });

    it('should not add duplicate observations', async () => {
      await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: ['works at Acme Corp'] },
      ]);

      await manager.addObservations([
        { entityName: 'Alice', contents: ['likes coffee'] },
      ]);

      const results = await manager.addObservations([
        { entityName: 'Alice', contents: ['likes coffee', 'has a dog'] },
      ]);

      expect(results[0].addedObservations).toHaveLength(1);
      expect(results[0].addedObservations).toContain('has a dog');

      const graph = await manager.readGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice?.observations).toHaveLength(3);
    });

    it('should throw error for non-existent entity', async () => {
      await expect(
        manager.addObservations([
          { entityName: 'NonExistent', contents: ['some observation'] },
        ])
      ).rejects.toThrow('Entity with name NonExistent not found');
    });
  });

  describe('deleteEntities', () => {
    it('should delete entities', async () => {
      await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: [] },
        { name: 'Bob', entityType: 'person', observations: [] },
      ]);

      await manager.deleteEntities(['Alice']);

      const graph = await manager.readGraph();
      expect(graph.entities).toHaveLength(1);
      expect(graph.entities[0].name).toBe('Bob');
    });

    it('should cascade delete relations when deleting entities', async () => {
      await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: [] },
        { name: 'Bob', entityType: 'person', observations: [] },
        { name: 'Charlie', entityType: 'person', observations: [] },
      ]);

      await manager.createRelations([
        { from: 'Alice', to: 'Bob', relationType: 'knows' },
        { from: 'Bob', to: 'Charlie', relationType: 'knows' },
      ]);

      await manager.deleteEntities(['Bob']);

      const graph = await manager.readGraph();
      expect(graph.entities).toHaveLength(2);
      expect(graph.relations).toHaveLength(0);
    });

    it('should handle deleting non-existent entities', async () => {
      await manager.deleteEntities(['NonExistent']);
      const graph = await manager.readGraph();
      expect(graph.entities).toHaveLength(0);
    });
  });

  describe('deleteObservations', () => {
    it('should delete observations from entities', async () => {
      await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: ['works at Acme Corp', 'likes coffee'] },
      ]);

      await manager.deleteObservations([
        { entityName: 'Alice', observations: ['likes coffee'] },
      ]);

      const graph = await manager.readGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice?.observations).toHaveLength(1);
      expect(alice?.observations).toContain('works at Acme Corp');
    });

    it('should handle deleting from non-existent entities', async () => {
      await manager.deleteObservations([
        { entityName: 'NonExistent', observations: ['some observation'] },
      ]);
      // Should not throw error
      const graph = await manager.readGraph();
      expect(graph.entities).toHaveLength(0);
    });
  });

  describe('deleteRelations', () => {
    it('should delete specific relations', async () => {
      await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: [] },
        { name: 'Bob', entityType: 'person', observations: [] },
      ]);

      await manager.createRelations([
        { from: 'Alice', to: 'Bob', relationType: 'knows' },
        { from: 'Alice', to: 'Bob', relationType: 'works_with' },
      ]);

      await manager.deleteRelations([
        { from: 'Alice', to: 'Bob', relationType: 'knows' },
      ]);

      const graph = await manager.readGraph();
      expect(graph.relations).toHaveLength(1);
      expect(graph.relations[0].relationType).toBe('works_with');
    });
  });

  describe('readGraph', () => {
    it('should return empty graph when file does not exist', async () => {
      const graph = await manager.readGraph();
      expect(graph.entities).toHaveLength(0);
      expect(graph.relations).toHaveLength(0);
    });

    it('should return complete graph with entities and relations', async () => {
      await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: ['works at Acme Corp'] },
      ]);

      await manager.createRelations([
        { from: 'Alice', to: 'Alice', relationType: 'self' },
      ]);

      const graph = await manager.readGraph();
      expect(graph.entities).toHaveLength(1);
      expect(graph.relations).toHaveLength(1);
    });
  });

  describe('searchNodes', () => {
    beforeEach(async () => {
      await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: ['works at Acme Corp', 'likes programming'] },
        { name: 'Bob', entityType: 'person', observations: ['works at TechCo'] },
        { name: 'Acme Corp', entityType: 'company', observations: ['tech company'] },
      ]);

      await manager.createRelations([
        { from: 'Alice', to: 'Acme Corp', relationType: 'works_at' },
        { from: 'Bob', to: 'Acme Corp', relationType: 'competitor' },
      ]);
    });

    it('should search by entity name', async () => {
      const result = await manager.searchNodes('Alice');
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Alice');
    });

    it('should search by entity type', async () => {
      const result = await manager.searchNodes('company');
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Acme Corp');
    });

    it('should search by observation content', async () => {
      const result = await manager.searchNodes('programming');
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Alice');
    });

    it('should be case insensitive', async () => {
      const result = await manager.searchNodes('ALICE');
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Alice');
    });

    it('should include relations where at least one endpoint matches', async () => {
      const result = await manager.searchNodes('Acme');
      expect(result.entities).toHaveLength(2); // Alice and Acme Corp
      // With new behavior: includes all relations touching matched entities
      // Alice -> Acme Corp (works_at) and Bob -> Acme Corp (competitor)
      expect(result.relations).toHaveLength(2);
    });

    it('should return empty graph for no matches', async () => {
      const result = await manager.searchNodes('NonExistent');
      expect(result.entities).toHaveLength(0);
      expect(result.relations).toHaveLength(0);
    });
  });

  describe('openNodes', () => {
    beforeEach(async () => {
      await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: [] },
        { name: 'Bob', entityType: 'person', observations: [] },
        { name: 'Charlie', entityType: 'person', observations: [] },
      ]);

      await manager.createRelations([
        { from: 'Alice', to: 'Bob', relationType: 'knows' },
        { from: 'Bob', to: 'Charlie', relationType: 'knows' },
      ]);
    });

    it('should open specific nodes by name', async () => {
      const result = await manager.openNodes(['Alice', 'Bob']);
      expect(result.entities).toHaveLength(2);
      expect(result.entities.map(e => e.name)).toContain('Alice');
      expect(result.entities.map(e => e.name)).toContain('Bob');
    });

    it('should include relations between opened nodes', async () => {
      const result = await manager.openNodes(['Alice', 'Bob']);
      expect(result.relations).toHaveLength(1);
      expect(result.relations[0].from).toBe('Alice');
      expect(result.relations[0].to).toBe('Bob');
    });

    it('should exclude relations to unopened nodes', async () => {
      const result = await manager.openNodes(['Bob']);
      expect(result.relations).toHaveLength(0);
    });

    it('should handle opening non-existent nodes', async () => {
      const result = await manager.openNodes(['NonExistent']);
      expect(result.entities).toHaveLength(0);
    });

    it('should handle empty node list', async () => {
      const result = await manager.openNodes([]);
      expect(result.entities).toHaveLength(0);
      expect(result.relations).toHaveLength(0);
    });
  });

  describe('file persistence', () => {
    it('should persist data across manager instances', async () => {
      await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: ['persistent data'] },
      ]);

      // Create new manager instance with same file path
      const manager2 = new KnowledgeGraphManager(testFilePath);
      const graph = await manager2.readGraph();

      expect(graph.entities).toHaveLength(1);
      expect(graph.entities[0].name).toBe('Alice');
    });

    it('should handle JSONL format correctly', async () => {
      await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: [] },
      ]);
      await manager.createRelations([
        { from: 'Alice', to: 'Alice', relationType: 'self' },
      ]);

      // Read file directly
      const fileContent = await fs.readFile(testFilePath, 'utf-8');
      const lines = fileContent.split('\n').filter(line => line.trim());

      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toHaveProperty('type', 'entity');
      expect(JSON.parse(lines[1])).toHaveProperty('type', 'relation');
    });
  });

  // ==================== New Advanced Search Tests ====================

  describe('advanced searchNodes', () => {
    beforeEach(async () => {
      await manager.createEntities([
        { name: 'AuthService', entityType: 'Service', observations: ['[2025-12-16] Purpose: Handles user authentication', 'Tech debt: needs refactoring'] },
        { name: 'AuthController', entityType: 'Module', observations: ['[2025-12-16] Purpose: HTTP endpoints for auth'] },
        { name: 'UserService', entityType: 'Service', observations: ['Manages user data', 'DEPRECATED: use AuthService'] },
        { name: 'Database', entityType: 'ExternalService', observations: ['PostgreSQL connection'] },
        { name: 'Redis', entityType: 'ExternalService', observations: ['Cache layer'] },
      ]);

      await manager.createRelations([
        { from: 'AuthController', to: 'AuthService', relationType: 'calls' },
        { from: 'AuthService', to: 'UserService', relationType: 'imports' },
        { from: 'AuthService', to: 'Database', relationType: 'persists_to' },
        { from: 'AuthService', to: 'Redis', relationType: 'caches_in' },
        { from: 'UserService', to: 'Database', relationType: 'persists_to' },
      ]);
    });

    it('should search with multiple words (OR logic)', async () => {
      const result = await manager.searchNodes('Auth User');
      // Should find AuthService, AuthController, UserService
      expect(result.entities.length).toBeGreaterThanOrEqual(3);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('AuthService');
      expect(names).toContain('AuthController');
      expect(names).toContain('UserService');
    });

    it('should search with required term (+)', async () => {
      const result = await manager.searchNodes('+Service +Auth');
      // Must have both "Service" and "Auth"
      const names = result.entities.map(e => e.name);
      expect(names).toContain('AuthService');
      // AuthController should NOT match (no "Service" in name or type)
      // UserService should NOT match (no "Auth")
    });

    it('should search with excluded term (-)', async () => {
      // Search for "Auth" but exclude anything with "Controller"
      const result = await manager.searchNodes('Auth -Controller');
      const names = result.entities.map(e => e.name);
      // Should find AuthService (has "Auth" but no "Controller")
      expect(names).toContain('AuthService');
      // Should NOT find AuthController (has "Controller")
      expect(names).not.toContain('AuthController');
    });

    it('should search with exact phrase', async () => {
      const result = await manager.searchNodes('"Tech debt"');
      // Only AuthService has "Tech debt" in observations
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('AuthService');
    });

    it('should search with field prefix name:', async () => {
      const result = await manager.searchNodes('name:Auth');
      // Should find entities with "Auth" in name
      const names = result.entities.map(e => e.name);
      expect(names).toContain('AuthService');
      expect(names).toContain('AuthController');
      expect(names).not.toContain('UserService');
    });

    it('should search with field prefix type:', async () => {
      const result = await manager.searchNodes('type:Module');
      // Should find entities of type "Module" (only AuthController)
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('AuthController');
    });

    it('should search with field prefix obs:', async () => {
      const result = await manager.searchNodes('obs:DEPRECATED');
      // Only UserService has DEPRECATED in observations
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('UserService');
    });

    it('should support fuzzy matching', async () => {
      // "Athservice" is close to "AuthService" (one char difference)
      const result = await manager.searchNodes('Athservice', { fuzzy: true });
      const names = result.entities.map(e => e.name);
      expect(names).toContain('AuthService');
    });

    it('should return scores with search results', async () => {
      const result = await manager.searchNodes('AuthService');
      expect(result.scores).toBeDefined();
      expect(result.scores!.length).toBeGreaterThan(0);
      // Exact name match should have highest score
      const authServiceScore = result.scores!.find(s => s.name === 'AuthService');
      expect(authServiceScore).toBeDefined();
      expect(authServiceScore!.score).toBeGreaterThanOrEqual(100);
    });

    it('should limit results', async () => {
      const result = await manager.searchNodes('Service', { limit: 2 });
      expect(result.entities.length).toBeLessThanOrEqual(2);
    });

    it('should include neighbors when requested', async () => {
      // Search for AuthService only, but include neighbors
      const result = await manager.searchNodes('name:AuthService', { includeNeighbors: true });
      const names = result.entities.map(e => e.name);
      // Should include AuthService plus its neighbors
      expect(names).toContain('AuthService');
      expect(names).toContain('AuthController'); // calls AuthService
      expect(names).toContain('UserService');    // AuthService imports
      expect(names).toContain('Database');       // AuthService persists_to
      expect(names).toContain('Redis');          // AuthService caches_in
    });

    it('should handle empty query', async () => {
      const result = await manager.searchNodes('');
      expect(result.entities).toHaveLength(0);
    });
  });

  // ==================== Graph Traversal Tests ====================

  describe('getNeighbors', () => {
    beforeEach(async () => {
      await manager.createEntities([
        { name: 'A', entityType: 'Module', observations: [] },
        { name: 'B', entityType: 'Module', observations: [] },
        { name: 'C', entityType: 'Module', observations: [] },
      ]);

      await manager.createRelations([
        { from: 'A', to: 'B', relationType: 'imports' },
        { from: 'C', to: 'A', relationType: 'calls' },
      ]);
    });

    it('should get all neighbors (both directions)', async () => {
      const neighbors = await manager.getNeighbors('A');
      expect(neighbors).toHaveLength(2);
      const names = neighbors.map(n => n.entity.name);
      expect(names).toContain('B');
      expect(names).toContain('C');
    });

    it('should get outgoing neighbors only', async () => {
      const neighbors = await manager.getNeighbors('A', { direction: 'outgoing' });
      expect(neighbors).toHaveLength(1);
      expect(neighbors[0].entity.name).toBe('B');
      expect(neighbors[0].direction).toBe('outgoing');
    });

    it('should get incoming neighbors only', async () => {
      const neighbors = await manager.getNeighbors('A', { direction: 'incoming' });
      expect(neighbors).toHaveLength(1);
      expect(neighbors[0].entity.name).toBe('C');
      expect(neighbors[0].direction).toBe('incoming');
    });

    it('should filter by relation type', async () => {
      const neighbors = await manager.getNeighbors('A', { relationType: 'imports' });
      expect(neighbors).toHaveLength(1);
      expect(neighbors[0].relation.relationType).toBe('imports');
    });

    it('should return empty for non-existent entity', async () => {
      const neighbors = await manager.getNeighbors('NonExistent');
      expect(neighbors).toHaveLength(0);
    });
  });

  describe('findPath', () => {
    beforeEach(async () => {
      await manager.createEntities([
        { name: 'A', entityType: 'Module', observations: [] },
        { name: 'B', entityType: 'Module', observations: [] },
        { name: 'C', entityType: 'Module', observations: [] },
        { name: 'D', entityType: 'Module', observations: [] },
        { name: 'Z', entityType: 'Module', observations: [] }, // Disconnected
      ]);

      await manager.createRelations([
        { from: 'A', to: 'B', relationType: 'imports' },
        { from: 'B', to: 'C', relationType: 'imports' },
        { from: 'C', to: 'D', relationType: 'imports' },
      ]);
    });

    it('should find direct path', async () => {
      const result = await manager.findPath('A', 'B');
      expect(result).not.toBeNull();
      expect(result!.length).toBe(1);
      expect(result!.path.map(e => e.name)).toEqual(['A', 'B']);
    });

    it('should find multi-hop path', async () => {
      const result = await manager.findPath('A', 'D');
      expect(result).not.toBeNull();
      expect(result!.length).toBe(3);
      expect(result!.path.map(e => e.name)).toEqual(['A', 'B', 'C', 'D']);
    });

    it('should return null for disconnected nodes', async () => {
      const result = await manager.findPath('A', 'Z');
      expect(result).toBeNull();
    });

    it('should return trivial path for same entity', async () => {
      const result = await manager.findPath('A', 'A');
      expect(result).not.toBeNull();
      expect(result!.length).toBe(0);
      expect(result!.path).toHaveLength(1);
    });

    it('should return null for non-existent entities', async () => {
      const result = await manager.findPath('A', 'NonExistent');
      expect(result).toBeNull();
    });

    it('should respect maxDepth', async () => {
      const result = await manager.findPath('A', 'D', 2);
      // Path A->B->C->D is length 3, exceeds maxDepth 2
      expect(result).toBeNull();
    });
  });

  describe('getSubgraph', () => {
    beforeEach(async () => {
      await manager.createEntities([
        { name: 'A', entityType: 'Module', observations: [] },
        { name: 'B', entityType: 'Module', observations: [] },
        { name: 'C', entityType: 'Module', observations: [] },
        { name: 'D', entityType: 'Module', observations: [] },
      ]);

      await manager.createRelations([
        { from: 'A', to: 'B', relationType: 'imports' },
        { from: 'B', to: 'C', relationType: 'imports' },
        { from: 'C', to: 'D', relationType: 'imports' },
      ]);
    });

    it('should get 1-hop subgraph', async () => {
      const result = await manager.getSubgraph(['B'], 1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('B');
      expect(names).toContain('A'); // connected to B
      expect(names).toContain('C'); // connected to B
      expect(names).not.toContain('D'); // 2 hops from B
    });

    it('should get 2-hop subgraph', async () => {
      const result = await manager.getSubgraph(['A'], 2);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('A');
      expect(names).toContain('B'); // 1 hop
      expect(names).toContain('C'); // 2 hops
    });

    it('should get 0-hop subgraph (just the entities)', async () => {
      const result = await manager.getSubgraph(['A', 'D'], 0);
      expect(result.entities).toHaveLength(2);
      expect(result.relations).toHaveLength(0); // No relations between A and D
    });
  });

  // ==================== Filtering Tests ====================

  describe('filterByType', () => {
    beforeEach(async () => {
      await manager.createEntities([
        { name: 'AuthService', entityType: 'Service', observations: [] },
        { name: 'UserService', entityType: 'Service', observations: [] },
        { name: 'AuthModule', entityType: 'Module', observations: [] },
      ]);

      await manager.createRelations([
        { from: 'AuthModule', to: 'AuthService', relationType: 'uses' },
      ]);
    });

    it('should filter entities by type', async () => {
      const result = await manager.filterByType('Service');
      expect(result.entities).toHaveLength(2);
      result.entities.forEach(e => {
        expect(e.entityType.toLowerCase()).toBe('service');
      });
    });

    it('should be case insensitive', async () => {
      const result = await manager.filterByType('service');
      expect(result.entities).toHaveLength(2);
    });

    it('should only include relations between filtered entities', async () => {
      const result = await manager.filterByType('Service');
      // AuthModule -> AuthService relation should NOT be included
      // because AuthModule is type Module, not Service
      expect(result.relations).toHaveLength(0);
    });
  });

  describe('filterRelations', () => {
    beforeEach(async () => {
      await manager.createEntities([
        { name: 'A', entityType: 'Module', observations: [] },
        { name: 'B', entityType: 'Module', observations: [] },
        { name: 'C', entityType: 'Module', observations: [] },
      ]);

      await manager.createRelations([
        { from: 'A', to: 'B', relationType: 'imports' },
        { from: 'A', to: 'C', relationType: 'calls' },
        { from: 'B', to: 'C', relationType: 'imports' },
      ]);
    });

    it('should filter by relation type', async () => {
      const result = await manager.filterRelations({ relationType: 'imports' });
      expect(result.relations).toHaveLength(2);
      result.relations.forEach(r => {
        expect(r.relationType).toBe('imports');
      });
    });

    it('should filter by fromEntity', async () => {
      const result = await manager.filterRelations({ fromEntity: 'A' });
      expect(result.relations).toHaveLength(2);
      result.relations.forEach(r => {
        expect(r.from).toBe('A');
      });
    });

    it('should filter by toEntity', async () => {
      const result = await manager.filterRelations({ toEntity: 'C' });
      expect(result.relations).toHaveLength(2);
      result.relations.forEach(r => {
        expect(r.to).toBe('C');
      });
    });

    it('should combine filters', async () => {
      const result = await manager.filterRelations({
        relationType: 'imports',
        fromEntity: 'A'
      });
      expect(result.relations).toHaveLength(1);
      expect(result.relations[0].from).toBe('A');
      expect(result.relations[0].to).toBe('B');
    });

    it('should include connected entities', async () => {
      const result = await manager.filterRelations({ relationType: 'imports' });
      const names = result.entities.map(e => e.name);
      expect(names).toContain('A');
      expect(names).toContain('B');
      expect(names).toContain('C');
    });
  });

  describe('filterByObservation', () => {
    beforeEach(async () => {
      await manager.createEntities([
        { name: 'Entity1', entityType: 'Module', observations: ['[2025-12-16] Purpose: Test'] },
        { name: 'Entity2', entityType: 'Module', observations: ['Tech debt: needs work'] },
        { name: 'Entity3', entityType: 'Module', observations: ['DEPRECATED: do not use'] },
        { name: 'Entity4', entityType: 'Module', observations: ['TODO: implement this'] },
        { name: 'Entity5', entityType: 'Module', observations: ['Normal observation'] },
      ]);
    });

    it('should filter by dated preset pattern', async () => {
      const result = await manager.filterByObservation('dated');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Entity1');
    });

    it('should filter by techdebt preset pattern', async () => {
      const result = await manager.filterByObservation('techdebt');
      expect(result.length).toBeGreaterThanOrEqual(2);
      const names = result.map(e => e.name);
      expect(names).toContain('Entity2'); // "Tech debt"
      expect(names).toContain('Entity4'); // "TODO"
    });

    it('should filter by deprecated preset pattern', async () => {
      const result = await manager.filterByObservation('deprecated');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Entity3');
    });

    it('should filter by custom regex pattern', async () => {
      const result = await manager.filterByObservation('Normal');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Entity5');
    });
  });

  describe('searchObservations', () => {
    beforeEach(async () => {
      await manager.createEntities([
        {
          name: 'Guilherme',
          entityType: 'Person',
          observations: [
            '[2025-11-26] Interviewing with LabV Intelligent Solutions GmbH',
            '[2025-11-26] Passed first round interview',
            '[2025-12-01] Working on React project',
            'Lives in Germany'
          ]
        },
        {
          name: 'TechCorp',
          entityType: 'Company',
          observations: [
            'AI startup founded in 2020',
            'Uses React and TypeScript',
            'Interviewing candidates'
          ]
        },
        {
          name: 'ProjectX',
          entityType: 'Project',
          observations: [
            'React application',
            'Uses TypeScript',
            'Deadline: December 2025'
          ]
        }
      ]);
    });

    it('should return matching observations with entity context', async () => {
      const result = await manager.searchObservations('LabV');
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].entityName).toBe('Guilherme');
      expect(result.matches[0].entityType).toBe('Person');
      expect(result.matches[0].observation).toContain('LabV');
      expect(result.matches[0].score).toBeGreaterThan(0);
    });

    it('should return multiple matching observations from same entity', async () => {
      const result = await manager.searchObservations('interview', { limit: 10 });
      expect(result.matches.length).toBeGreaterThanOrEqual(2);
      // Should find observations from both Guilherme and TechCorp
      const entityNames = result.matches.map(m => m.entityName);
      expect(entityNames).toContain('Guilherme');
      expect(entityNames).toContain('TechCorp');
    });

    it('should respect limit parameter', async () => {
      const result = await manager.searchObservations('React', { limit: 2 });
      expect(result.matches).toHaveLength(2);
    });

    it('should sort by relevance score descending', async () => {
      const result = await manager.searchObservations('React TypeScript');
      for (let i = 1; i < result.matches.length; i++) {
        expect(result.matches[i - 1].score).toBeGreaterThanOrEqual(result.matches[i].score);
      }
    });

    it('should support boolean AND with + operator', async () => {
      const result = await manager.searchObservations('+interview +LabV');
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].observation).toContain('LabV');
    });

    it('should support exclusion with - operator', async () => {
      const result = await manager.searchObservations('interview -LabV');
      // Should find TechCorp's "Interviewing candidates" but not LabV observation
      expect(result.matches.length).toBeGreaterThanOrEqual(1);
      result.matches.forEach(m => {
        expect(m.observation.toLowerCase()).not.toContain('labv');
      });
    });

    it('should support exact phrase matching', async () => {
      const result = await manager.searchObservations('"first round"');
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].observation).toContain('first round');
    });

    it('should return empty results for non-matching query', async () => {
      const result = await manager.searchObservations('nonexistent');
      expect(result.matches).toHaveLength(0);
    });

    it('should handle empty query', async () => {
      const result = await manager.searchObservations('');
      expect(result.matches).toHaveLength(0);
    });

    it('should include full entities when includeEntity is true', async () => {
      const result = await manager.searchObservations('LabV', { includeEntity: true });
      expect(result.entities).toBeDefined();
      expect(result.entities).toHaveLength(1);
      expect(result.entities![0].name).toBe('Guilherme');
      expect(result.entities![0].observations).toHaveLength(4);
    });

    it('should not include entities when includeEntity is false', async () => {
      const result = await manager.searchObservations('LabV', { includeEntity: false });
      expect(result.entities).toBeUndefined();
    });

    it('should support fuzzy matching when enabled', async () => {
      // "Recat" is a typo for "React" (transposition - distance of 2, but substring match works)
      const result = await manager.searchObservations('Rect', { fuzzy: true });
      expect(result.matches.length).toBeGreaterThanOrEqual(1);
    });

    it('should find dated observations', async () => {
      const result = await manager.searchObservations('[2025-11-26]');
      expect(result.matches).toHaveLength(2);
      result.matches.forEach(m => {
        expect(m.observation).toContain('[2025-11-26]');
      });
    });
  });
});
