# Test Prompt for Better Memory MCP

Use this prompt to test the knowledge graph memory server functionality.

---

## Basic Test

```
Test the memory MCP by doing the following:

1. Create entities:
   - Create a "person" entity named "Alice" with observations: "Software engineer", "Works remotely"
   - Create an "organization" entity named "TechCorp" with observations: "AI startup", "Founded in 2020"
   - Create a "project" entity named "GraphDB" with observations: "Database project", "Uses Rust"

2. Create relations:
   - Alice works_at TechCorp
   - Alice contributes_to GraphDB
   - TechCorp sponsors GraphDB

3. Test search:
   - Search for "Alice"
   - Search for "AI startup" (should find TechCorp)
   - Search with boolean: "+Alice +engineer"
   - Search with exclusion: "project -Rust"
   - Search with field prefix: "type:person"

4. Test graph traversal:
   - Get neighbors of Alice
   - Find path from Alice to GraphDB
   - Get 1-hop subgraph around TechCorp

5. Test filtering:
   - Filter by type "person"
   - Filter relations where fromEntity is "Alice"

6. Read the full graph to verify everything was stored correctly.

Report what you find at each step.
```

---

## Quick Smoke Test

```
Quickly test the memory MCP:
1. Create an entity named "TestEntity" of type "test" with observation "Created for testing"
2. Search for "TestEntity"
3. Delete the entity
4. Verify it's gone by searching again
```
