# Knowledge Graph Memory Server

> Enhanced fork of [@modelcontextprotocol/server-memory](https://github.com/modelcontextprotocol/servers/tree/main/src/memory)

A full-featured persistent memory system using a local knowledge graph. This lets Claude remember information about the user across chats, with advanced search, graph traversal, and filtering capabilities.

## Core Concepts

### Entities
Entities are the primary nodes in the knowledge graph. Each entity has:
- A unique name (identifier)
- An entity type (e.g., "person", "organization", "event")
- A list of observations

Example:
```json
{
  "name": "John_Smith",
  "entityType": "person",
  "observations": ["Speaks fluent Spanish"]
}
```

### Relations
Relations define directed connections between entities. They are always stored in active voice and describe how entities interact or relate to each other.

Example:
```json
{
  "from": "John_Smith",
  "to": "Anthropic",
  "relationType": "works_at"
}
```
### Observations
Observations are discrete pieces of information about an entity. They are:

- Stored as strings
- Attached to specific entities
- Can be added or removed independently
- Should be atomic (one fact per observation)

Example:
```json
{
  "entityName": "John_Smith",
  "observations": [
    "Speaks fluent Spanish",
    "Graduated in 2019",
    "Prefers morning meetings"
  ]
}
```

## API

### Tools

#### CRUD Operations
- **create_entities**
  - Create multiple new entities in the knowledge graph
  - Input: `entities` (array of objects)
    - Each object contains:
      - `name` (string): Entity identifier
      - `entityType` (string): Type classification
      - `observations` (string[]): Associated observations
  - Ignores entities with existing names

- **create_relations**
  - Create multiple new relations between entities
  - Input: `relations` (array of objects)
    - Each object contains:
      - `from` (string): Source entity name
      - `to` (string): Target entity name
      - `relationType` (string): Relationship type in active voice
  - Skips duplicate relations

- **add_observations**
  - Add new observations to existing entities
  - Input: `observations` (array of objects)
    - Each object contains:
      - `entityName` (string): Target entity
      - `contents` (string[]): New observations to add
  - Returns added observations per entity
  - Fails if entity doesn't exist

- **delete_entities**
  - Remove entities and their relations
  - Input: `entityNames` (string[])
  - Cascading deletion of associated relations
  - Silent operation if entity doesn't exist

- **delete_observations**
  - Remove specific observations from entities
  - Input: `deletions` (array of objects)
    - Each object contains:
      - `entityName` (string): Target entity
      - `observations` (string[]): Observations to remove
  - Silent operation if observation doesn't exist

- **delete_relations**
  - Remove specific relations from the graph
  - Input: `relations` (array of objects)
    - Each object contains:
      - `from` (string): Source entity name
      - `to` (string): Target entity name
      - `relationType` (string): Relationship type
  - Silent operation if relation doesn't exist

- **read_graph**
  - Read the entire knowledge graph
  - No input required
  - Returns complete graph structure with all entities and relations

#### Search & Retrieval

- **search_nodes** (Enhanced)
  - Advanced search with boolean operators, field prefixes, fuzzy matching, and relevance scoring
  - Input:
    - `query` (string): Search query with advanced syntax support
    - `includeNeighbors` (boolean, optional): Include 1-hop connected entities
    - `fuzzy` (boolean, optional): Enable fuzzy matching for typo tolerance
    - `limit` (number, optional): Maximum results to return
  - Query Syntax:
    - Multiple words: OR logic (matches any word)
    - `+term`: Required (must be present)
    - `-term`: Excluded (must NOT be present)
    - `"phrase"`: Exact phrase match
    - `name:value`: Search only entity names
    - `type:value`: Search only entity types
    - `obs:value`: Search only observations
  - Examples:
    - `"auth module"` - finds entities matching "auth" OR "module"
    - `"+auth +security"` - finds entities matching BOTH
    - `"auth -deprecated"` - finds "auth" but excludes "deprecated"
    - `"name:AuthService type:Module"` - field-specific search
  - Returns matching entities, relations (where at least one endpoint matches), and relevance scores

- **open_nodes**
  - Retrieve specific nodes by name
  - Input: `names` (string[])
  - Returns:
    - Requested entities
    - Relations between requested entities
  - Silently skips non-existent nodes

- **search_observations** (New)
  - Search at the observation level, returning individual matching observations instead of entire entities
  - More efficient than `search_nodes` when you need specific facts rather than full entity data
  - Reduces token usage by returning only relevant observations
  - Input:
    - `query` (string): Search query (same syntax as search_nodes)
    - `limit` (number, optional): Maximum observations to return (default: 10)
    - `includeEntity` (boolean, optional): Include full parent entities in response
    - `fuzzy` (boolean, optional): Enable fuzzy matching for typo tolerance
  - Returns:
    - `matches`: Array of matching observations with:
      - `entityName`: Parent entity name
      - `entityType`: Parent entity type
      - `observation`: The matching observation text
      - `score`: Relevance score
    - `entities` (optional): Full parent entities if `includeEntity` is true
  - Example query: `"+interview +German"` returns only observations containing both terms

### Graph Traversal Tools

- **get_neighbors**
  - Get all entities directly connected to a given entity
  - Input:
    - `entityName` (string): The entity to find neighbors for
    - `direction` (optional): `'incoming'`, `'outgoing'`, or `'both'` (default)
    - `relationType` (optional): Filter by specific relation type
  - Returns array of neighbors with entity, relation, and direction

- **find_path**
  - Find shortest path between two entities using BFS
  - Input:
    - `fromEntity` (string): Starting entity
    - `toEntity` (string): Target entity
    - `maxDepth` (number, optional): Maximum path length (default: 10)
  - Returns path (entities), relations, and length; or null if no path exists

- **get_subgraph**
  - Extract N-hop neighborhood around seed entities
  - Input:
    - `entityNames` (string[]): Seed entities
    - `depth` (number, optional): Hops to expand (default: 1)
  - Returns subgraph with entities and relations within the neighborhood

### Filtering Tools

- **filter_by_type**
  - Get all entities of a specific type
  - Input: `entityType` (string, case-insensitive)
  - Returns entities of that type and relations between them

- **filter_relations**
  - Filter relations by type, source, or target
  - Input (all optional):
    - `relationType`: Filter by relation type
    - `fromEntity`: Filter by source entity
    - `toEntity`: Filter by target entity
  - Returns matching relations and connected entities

- **filter_observations**
  - Find entities with observations matching patterns
  - Input: `pattern` (string)
  - Preset patterns:
    - `"dated"` - Observations starting with `[YYYY-MM-DD]`
    - `"techdebt"` - Contains TODO, FIXME, HACK, or "tech debt"
    - `"deprecated"` - Mentions deprecated
    - `"purpose"` - Contains "Purpose:"
    - `"quirk"` - Contains "Quirk:"
  - Or provide a custom regex pattern

## Installation

### Option 1: Desktop Extension (Recommended)

Install directly in Claude Desktop using the bundled extension:

1. Download the latest `.mcpb` file from [Releases](https://github.com/guinacio/better-memory-mcp/releases)
2. Open Claude Desktop
3. Go to **Settings** → **Extensions**
4. Click **Install from file** and select the `.mcpb` file
5. Configure the memory file path when prompted (optional)

### Option 2: Manual Installation

#### Prerequisites

1. Clone this repository
2. Install dependencies and build:
   ```sh
   npm install
   npm run build
   ```

#### Configuration

The server can be configured using the following environment variable:

- `MEMORY_FILE_PATH`: Path to the memory storage JSONL file (default: `memory.jsonl` in the server directory)

#### Claude Desktop (Manual Config)

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["C:/path/to/better-memory-mcp/dist/index.js"],
      "env": {
        "MEMORY_FILE_PATH": "C:/path/to/your/memory.jsonl"
      }
    }
  }
}
```

Replace `C:/path/to/better-memory-mcp` with the actual path to this repository.

#### VS Code

Add the configuration to your MCP settings using one of these methods:

**Method 1: User Configuration (Recommended)**
Open the Command Palette (`Ctrl + Shift + P`) and run `MCP: Open User Configuration`. Add the server configuration to your `mcp.json` file.

**Method 2: Workspace Configuration**
Add the configuration to `.vscode/mcp.json` in your workspace.

```json
{
  "servers": {
    "memory": {
      "command": "node",
      "args": ["C:/path/to/better-memory-mcp/dist/index.js"],
      "env": {
        "MEMORY_FILE_PATH": "C:/path/to/your/memory.jsonl"
      }
    }
  }
}
```

> For more details about MCP configuration in VS Code, see the [official VS Code MCP documentation](https://code.visualstudio.com/docs/copilot/customization/mcp-servers).

### System Prompt

The prompt for utilizing memory depends on the use case. Changing the prompt will help the model determine the frequency and types of memories created.

Here is an example prompt for chat personalization. You could use this prompt in the "Custom Instructions" field of a [Claude.ai Project](https://www.anthropic.com/news/projects).

```
Follow these steps for each interaction:

1. User Identification:
   - You should assume that you are interacting with default_user
   - If you have not identified default_user, proactively try to do so.

2. Memory Retrieval:
   - Always begin your chat by saying only "Remembering..." and retrieve all relevant information from your knowledge graph
   - Always refer to your knowledge graph as your "memory"
   - Use advanced search queries to find relevant context:
     - Search multiple topics: "project deadline meeting"
     - Required terms: "+user +preferences"
     - Exclude irrelevant: "work -personal"
     - Field-specific: "type:person name:John"

3. Memory
   - While conversing with the user, be attentive to any new information that falls into these categories:
     a) Basic Identity (age, gender, location, job title, education level, etc.)
     b) Behaviors (interests, habits, etc.)
     c) Preferences (communication style, preferred language, etc.)
     d) Goals (goals, targets, aspirations, etc.)
     e) Relationships (personal and professional relationships up to 3 degrees of separation)

4. Memory Update:
   - If any new information was gathered during the interaction, update your memory as follows:
     a) Create entities for recurring organizations, people, and significant events
     b) Connect them to the current entities using relations
     c) Store facts about them as observations
     d) Use dated observations for time-sensitive info: "[2025-01-15] Started new project"

5. Memory Exploration:
   - Use get_neighbors to explore connections around an entity
   - Use find_path to understand how two entities are related
   - Use filter_by_type to get all entities of a category (e.g., all "person" entities)
   - Use filter_observations with "techdebt" or "deprecated" to find items needing attention
```

## Development

### Build
```sh
npm run build
```

### Watch mode
```sh
npm run watch
```

### Run tests
```sh
npm test
```

### Build Desktop Extension
To build the `.mcpb` extension bundle:
```sh
npm run bundle
```

This creates a `better-memory-mcp.mcpb` file that can be installed directly in Claude Desktop.

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.
