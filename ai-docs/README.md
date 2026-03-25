# ai-docs

Behavioral documentation for the Map Compare project.

## Purpose

These documents describe **what** each subsystem and module does — responsibilities, inputs, outputs, and contracts. They do **not** describe implementation details (internal data structures, algorithm internals, specific library calls).

## No-implementation-leakage rule

Every sub-doc must describe behavior from the perspective of an external consumer. If a statement would become false after an internal refactor (while preserving the same interface), it does not belong here.

## Structure

- `subsystems/` — docs for logical groupings of related functionality
- `modules/` — docs for individual complex modules that warrant deep documentation

## Agent update protocol

After any non-trivial implementation change, run `/aidocs-update` to keep these documents in sync with the codebase.
