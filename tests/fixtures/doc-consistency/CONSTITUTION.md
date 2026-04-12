# Test Workspace

A workspace for testing doc-consistency validation.

## Architecture

The workspace has 3 modules and 2 agents.

## Documentation Contracts

| Document  | Section | Claim         | Strategy | Pattern           | Path |
| --------- | ------- | ------------- | -------- | ----------------- | ---- |
| README.md | Modules | count         | glob     | src/modules/\*.ts | .    |
| README.md | Modules | list_complete | glob     | src/modules/\*.ts | .    |
| README.md | Agents  | count         | glob     | src/agents/\*.ts  | .    |
| README.md | Agents  | list_complete | glob     | src/agents/\*.ts  | .    |

## Other Section

This section should be ignored by the contract parser.
