# ADR-0002: Service Splitting Policy

Status: Accepted
Date: 2026-03-26

## Decision
Split runtime capabilities into independent services:
- control-plane
- browser-automation

## Service Boundary Rules
- Transport contracts only through `packages/capability-protocol`
- No direct imports between service internals
- Cross-service calls must be explicit RPC/event interfaces
