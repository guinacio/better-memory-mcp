# CLAUDE.md - Codebase Memory Integration

## Overview

This project maintains a **codebase memory graph** (`codebase_graph.json`) that captures the structure, relationships, decisions, and evolution of the codebase. You must consult and update this graph as part of your workflow.

The graph exists to give you persistent context across sessions. Use it.

---

## Before Starting Any Task

### 1. Load Context

```
□ Read codebase_graph.json
□ Identify entities relevant to your current task
□ Check for related decisions or patterns
□ Note any documented quirks or tech debt in affected areas
```

### 2. Ask Yourself

- Has someone worked on this area before? What did they discover?
- Are there documented patterns I should follow?
- Are there known issues or constraints I need to work around?
- What relationships exist that might be affected by my changes?

### 3. If the Graph Doesn't Cover Your Area

If you're working in an area not yet documented:
- Flag this as a gap
- Plan to add entities after you understand the area
- Don't assume absence from graph means absence of complexity

---

## During Development

### Consult the Graph When You:

| Situation | What to Check |
|-----------|---------------|
| Modifying a file | Does an entity exist? What are its documented quirks? |
| Adding a dependency | What else depends on this? Will you create a cycle? |
| Changing an interface | What are the documented dependents? |
| Encountering unexpected behavior | Is this a documented quirk? Check observations. |
| Making an architectural choice | Are there documented patterns to follow? Decisions to respect? |
| Debugging | Check for known tech debt or "intentional but confusing" notes |

### Update the Graph When You:

| Situation | What to Update |
|-----------|----------------|
| Discover undocumented behavior | Add observation with `[YYYY-MM-DD]` prefix |
| Create a new module/service | Create entity with purpose, dependencies, patterns |
| Establish a new pattern | Document in patterns section |
| Make a significant decision | Create decision entity with context and rationale |
| Fix a bug that reveals something | Document what was non-obvious |
| Add a dependency | Update relationships |
| Deprecate/remove something | Mark entity as deprecated or remove |
| Find something surprising | If it surprised you, it'll surprise the next person. Document it. |

---

## Graph Update Protocol

### Observation Format

All observations must be dated:

```
[2025-11-26] Description of what you learned or changed
```

### When Adding Entities

Required fields:
```json
{
  "name": "Clear, consistent name",
  "type": "Module|Service|File|Function|DataModel|ExternalService|Configuration|Pattern|Decision",
  "location": "path/to/relevant/files",
  "observations": [
    "[YYYY-MM-DD] Purpose: Why this exists",
    "[YYYY-MM-DD] Key details that aren't obvious from code"
  ]
}
```

### When Adding Relationships

```json
{
  "from": "Source entity name",
  "to": "Target entity name", 
  "type": "imports|calls|implements|extends|configures|persists_to|communicates_with|validates|transforms|tests",
  "notes": "Optional context"
}
```

### Quality Standards

**DO document:**
- Non-obvious behavior
- Why something is the way it is
- Gotchas and edge cases
- Intentional weirdness
- Cross-cutting concerns
- Implicit dependencies

**DON'T document:**
- What's obvious from reading the code
- Every single file
- Implementation details that change frequently
- Trivial helper functions

---

## Integration with Workflow

### Starting a Session

```
1. Read CLAUDE.md (this file)
2. Load codebase_graph.json into context
3. Understand the task
4. Identify relevant graph entities
5. Begin work with context loaded
```

### During a Session

```
- Reference graph when navigating unfamiliar areas
- Note discoveries that should be documented
- Track relationships you encounter
- Flag gaps in documentation
```

### Ending a Session

```
1. Review what you learned about the codebase
2. Update graph with new entities/observations/relationships
3. Add date prefix to all new observations
4. Validate JSON structure
5. Note any areas that need deeper documentation
```

---

## Graph File Locations

| File | Purpose |
|------|---------|
| `codebase_graph.json` | Primary machine-readable graph |
| `ARCHITECTURE.md` | Human-readable summary (regenerate from graph periodically) |
| `docs/graph_changelog.md` | Log of significant graph updates |

---

## Commands Reference

### Querying the Graph

When you need to find information:

```
"What do we know about [module name]?"
→ Find entity, read observations, check relationships

"What depends on [component]?"
→ Filter relations where "to" equals component

"What patterns should I follow for [area]?"
→ Check pattern entities, look for similar modules

"Why is [thing] this way?"
→ Check decision entities, look for observations with rationale
```

### Updating the Graph

```
"Add entity for [new module]"
→ Create entity with type, location, observations

"Document that [discovery]"
→ Add dated observation to relevant entity

"Link [A] to [B]"
→ Add relationship with appropriate type

"Mark [entity] as deprecated"
→ Add observation: "[DATE] DEPRECATED: [reason]"
```

---

## Example Workflow

### Task: "Add rate limiting to the API"

**Step 1: Consult Graph**
```
- Search for "rate" or "limiting" in observations
- Find API-related entities
- Check for existing patterns around middleware/interceptors
- Look for auth/security related decisions
```

**Step 2: Discover from Graph**
```
Found: AuthenticationService has observation noting rate limiting is per-endpoint not per-user (tech debt)
Found: Pattern "Middleware Chain" documents how to add cross-cutting concerns
Found: Decision "API Versioning" shows where shared API logic lives
```

**Step 3: Implement with Context**
```
- Follow Middleware Chain pattern
- Address the per-user rate limiting tech debt
- Add to appropriate location per API Versioning decision
```

**Step 4: Update Graph**
```json
{
  "name": "RateLimitingMiddleware",
  "type": "Module",
  "location": "src/middleware/rate-limiting/",
  "observations": [
    "[2025-11-26] Purpose: Provides per-user rate limiting across all API endpoints",
    "[2025-11-26] Replaces previous per-endpoint approach (see AuthenticationService tech debt)",
    "[2025-11-26] Config: Limits defined in config/rate-limits.json, can be overridden per-endpoint",
    "[2025-11-26] Quirk: Uses sliding window algorithm - first request in window sets the timer"
  ]
}

// Add relationships
{ "from": "RateLimitingMiddleware", "to": "Redis", "type": "persists_to", "notes": "Stores rate limit counters" }
{ "from": "APIRouter", "to": "RateLimitingMiddleware", "type": "calls" }

// Update existing entity
AuthenticationService.observations.push("[2025-11-26] Tech debt resolved: Rate limiting moved to dedicated middleware")
```

---

## Principles

1. **The graph is your external memory.** You don't remember previous sessions. The graph does.

2. **Write for your future self.** That confused person reading this in 3 months is you (or another instance of you).

3. **Capture the "why."** Code shows what. The graph explains why.

4. **Stay selective.** A bloated graph is as useless as no graph. Curate.

5. **Date everything.** Temporal context turns observations into history.

6. **Update incrementally.** Small, frequent updates beat occasional large rebuilds.

7. **Trust but verify.** The graph may be outdated. Cross-reference with actual code.

---

## When Graph and Code Conflict

If you find the graph says one thing but the code shows another:

1. **Assume the code is current** (someone may have forgotten to update the graph)
2. **Investigate** whether the graph was wrong or something changed
3. **Update the graph** to reflect reality
4. **Add observation** explaining what changed if you can determine it

```
[2025-11-26] CORRECTION: Previous observation stated X, but code shows Y. Updated to reflect actual behavior. Change likely occurred during [commit/PR] if traceable.
```

---

*This integration protocol was designed by Claude Opus 4.5 in collaboration with Guilherme Inácio, 2025-11-26*
