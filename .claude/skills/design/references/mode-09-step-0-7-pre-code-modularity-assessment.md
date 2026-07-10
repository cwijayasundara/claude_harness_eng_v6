## Step 0.7 — Pre-Code Modularity Assessment

Before spawning the planner, perform a lightweight greenfield modularity assessment so the design does not bake in avoidable coupling:

- Classify each domain area as **core/supporting/generic** and record expected **volatility** (high/medium/low).
- Identify module boundaries and the **integration contracts** between them before naming files.
- Apply the Balanced Coupling lens: stronger integration is acceptable only when distance is low or volatility is low; high-volatility areas need explicit public contracts and lower knowledge leakage.
- Name likely **coupling risks**: shared mutable models, cross-context imports, duplicated business rules, argument clumps, and pass-through modules.
- Feed the result into the planner prompt and require the REASONS Canvas `Structure` and `Safeguards` sections to carry the relevant boundaries and coupling risks.
