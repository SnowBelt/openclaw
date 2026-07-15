# PCC UI architecture

The PCC UI keeps its historical entry points while separating stable contracts,
application policy, infrastructure adapters, and presentation behavior.

```text
ui/src/ui/
├── controllers/pcc.ts                 # compatibility facade and use-case orchestration
├── views/pcc.ts                       # compatibility facade and Lit composition root
└── pcc/
    ├── contracts.ts                   # state, input, output, and callback ports
    ├── form-state.ts                  # canonical empty form factories
    ├── policies.ts                    # shared status policies
    ├── application/
    │   ├── execution-team.ts          # pure execution readiness and model policy
    │   └── state-transitions.ts       # synchronous UI state use cases
    ├── infrastructure/
    │   └── gateway-payloads.ts        # ledger-to-Gateway anti-corruption adapter
    └── presentation/
        ├── autopilot-panel.ts         # Autopilot project-loop presentation component
        ├── interactions.ts            # DOM drag, confirmation, and menu behavior
        └── project-selectors.ts       # project filtering, attention, and search read models
```

## Dependency direction

- Presentation depends on contracts and domain policies, never controllers or Gateway adapters.
- Application services depend on contracts and `src/pcc` domain modules, never Lit or DOM code.
- Infrastructure adapters translate UI/domain records into strict Gateway payloads.
- `controllers/pcc.ts` composes use cases and remains the public compatibility facade.
- `views/pcc.ts` composes Lit sections and remains the lazy-loaded view compatibility facade.

New PCC behavior should enter through the narrowest layer that owns it. Avoid adding
new policy to the view, DOM behavior to the controller, or Gateway schema knowledge to
application services. `architecture.test.ts` fails if these dependency boundaries regress.
