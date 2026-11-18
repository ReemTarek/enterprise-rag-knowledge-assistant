# ADR 0003: .NET 11 / Node 26 toolchain

Status: Accepted

## Context
The user chose .NET SDK 11.0.100 and Node 26. Neither is an LTS release. Installed and verified locally: `dotnet --version` = 11.0.100, `node --version` = v26.13.1.

## Decision
- Pin the SDK in `global.json` (`11.0.100`, `rollForward: latestFeature`).
- Node 26 for the frontend. Angular compatibility was checked on 2026-11-18 against the official table (https://angular.dev/reference/versions): Angular 22.x requires Node `^22.22.3 || ^24.15.0 || ^26.0.0`, so Node 26 is supported by Angular 22. Angular 21 and 20 do not list Node 26. Supported Angular versions listed: 20.0 through 22.x. Angular is not scaffolded in Phase 1; use Angular 22 when it is.
- Pre-approved fallback: if a package or the Angular CLI proves incompatible, fall back to .NET 10 LTS and/or the current Node LTS (Node 24).

## Consequences
- Access to newest features, but shorter support windows and a higher risk of package incompatibility.
- Re-verify Angular/Node compatibility when the frontend is scaffolded.
