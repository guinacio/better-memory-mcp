import { promises as fs } from "fs";
import kuzu from "kuzu";

export interface EntityRecord {
  name: string;
  entityType: string;
  observations: string[];
}

export interface RelationRecord {
  from: string;
  to: string;
  relationType: string;
}

export interface GraphRecord {
  entities: EntityRecord[];
  relations: RelationRecord[];
  [key: string]: unknown;
}

function escapeLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "''");
}

function observationsToString(observations: string[]): string {
  return JSON.stringify(observations ?? []);
}

function observationsFromString(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((v) => typeof v === "string");
    }
    return [];
  } catch {
    return [];
  }
}

async function queryRows(conn: kuzu.Connection, cypher: string): Promise<Record<string, unknown>[]> {
  const result = await conn.query(cypher);
  const queryResult = Array.isArray(result) ? result[0] : result;
  const rows = await queryResult.getAll();
  return rows as Record<string, unknown>[];
}

export class KuzuGraphStore {
  private db: kuzu.Database;
  private conn: kuzu.Connection;
  private importMarkerPath: string;

  constructor(private kuzuDbPath: string) {
    this.db = new kuzu.Database(kuzuDbPath);
    this.conn = new kuzu.Connection(this.db);
    this.importMarkerPath = `${this.kuzuDbPath}.jsonl_imported`;
  }

  async bootstrapSchema(): Promise<void> {
    await this.conn.query(`
      CREATE NODE TABLE IF NOT EXISTS Entity(
        name STRING,
        entityType STRING,
        observations STRING,
        PRIMARY KEY(name)
      )
    `);
    await this.conn.query(`
      CREATE REL TABLE IF NOT EXISTS Rel(
        FROM Entity TO Entity,
        relationType STRING
      )
    `);
  }

  async readGraph(): Promise<GraphRecord> {
    const entityRows = await queryRows(
      this.conn,
      "MATCH (e:Entity) RETURN e.name AS name, e.entityType AS entityType, e.observations AS observations"
    );
    const relationRows = await queryRows(
      this.conn,
      "MATCH (a:Entity)-[r:Rel]->(b:Entity) RETURN a.name AS from, b.name AS to, r.relationType AS relationType"
    );

    const entities: EntityRecord[] = entityRows.map((row) => ({
      name: String(row.name ?? ""),
      entityType: String(row.entityType ?? ""),
      observations: observationsFromString((row.observations as string | undefined) ?? "[]"),
    }));

    const relations: RelationRecord[] = relationRows.map((row) => ({
      from: String(row.from ?? ""),
      to: String(row.to ?? ""),
      relationType: String(row.relationType ?? ""),
    }));

    return { entities, relations };
  }

  async replaceGraph(graph: GraphRecord): Promise<void> {
    await this.conn.query("MATCH (e:Entity) DETACH DELETE e");

    for (const entity of graph.entities) {
      await this.conn.query(`
        CREATE (e:Entity {
          name: '${escapeLiteral(entity.name)}',
          entityType: '${escapeLiteral(entity.entityType)}',
          observations: '${escapeLiteral(observationsToString(entity.observations))}'
        })
      `);
    }

    for (const relation of graph.relations) {
      await this.conn.query(`
        MATCH (a:Entity {name: '${escapeLiteral(relation.from)}'}), (b:Entity {name: '${escapeLiteral(relation.to)}'})
        MERGE (a)-[r:Rel {relationType: '${escapeLiteral(relation.relationType)}'}]->(b)
      `);
    }
  }

  async importFromJsonlIfNeeded(memoryFilePath: string): Promise<void> {
    const alreadyImported = await fs
      .access(this.importMarkerPath)
      .then(() => true)
      .catch(() => false);
    if (alreadyImported) {
      return;
    }

    const hasSource = await fs
      .access(memoryFilePath)
      .then(() => true)
      .catch(() => false);
    if (!hasSource) {
      await fs.writeFile(this.importMarkerPath, "no-source");
      return;
    }

    const raw = await fs.readFile(memoryFilePath, "utf-8");
    const entities: EntityRecord[] = [];
    const relations: RelationRecord[] = [];

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        if (obj.type === "entity") {
          entities.push({
            name: String(obj.name ?? ""),
            entityType: String(obj.entityType ?? ""),
            observations: Array.isArray(obj.observations)
              ? (obj.observations.filter((v) => typeof v === "string") as string[])
              : [],
          });
        } else if (obj.type === "relation") {
          relations.push({
            from: String(obj.from ?? ""),
            to: String(obj.to ?? ""),
            relationType: String(obj.relationType ?? ""),
          });
        }
      } catch {
        // Skip malformed lines during import to keep startup resilient.
      }
    }

    const dedupedEntities = entities.filter(
      (entity, i) => entities.findIndex((e) => e.name === entity.name) === i
    );
    const dedupedRelations = relations.filter(
      (relation, i) =>
        relations.findIndex(
          (r) =>
            r.from === relation.from &&
            r.to === relation.to &&
            r.relationType === relation.relationType
        ) === i
    );

    await this.replaceGraph({ entities: dedupedEntities, relations: dedupedRelations });
    await fs.writeFile(this.importMarkerPath, `imported:${new Date().toISOString()}`);
  }

  async close(): Promise<void> {
    await this.conn.close();
    await this.db.close();
  }
}

