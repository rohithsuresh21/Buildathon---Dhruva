# src/lib/agents

| File | Role |
|---|---|
| `orchestrator.ts` | Runs the stages in order and emits trace and result events |
| `intake.ts` | Parses the shipment sentence into places, cargo and a mode hint |
| `planner.ts` | Builds candidate itineraries and the safer-routing search |
| `signals.ts` | Specialist checks that turn live feeds into signals per leg |
| `structured.ts` | Optional model call with a schema, used only to rephrase or assist parsing |

The verdict itself is computed by `../judge.ts` and `../safety.ts`, deterministically.
