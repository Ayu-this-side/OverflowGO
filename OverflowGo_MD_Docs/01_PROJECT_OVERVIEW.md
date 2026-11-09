# OverflowGo: Project Overview

## 1. Problem
Municipal garbage vans collect from community bins once a day, in the morning, on a **fixed route** (e.g. A -> B -> C -> D).
Low-density localities (A) never fill their bins. High-density localities (D) fill their bins within 2-3 hours of collection and then overflow until the next morning (often ~10 AM, when the van finally reaches them).
The fixed route ignores real demand.

## 2. Solution
A demand-driven layer on top of the fixed route:
1. Citizens report overflowing bins with a **live photo** (no login).
2. An **AI model** checks that the photo shows an overflowing bin or garbage. Invalid reports are rejected.
3. Valid reports become **tickets**.
4. Tickets are handled in two ways:
   - **Live dispatch:** if drivers are online nearby, a Rapido/Uber-style pop-up is sent to all online drivers within a 3 km geofence. The first driver to accept gets the job and an **extra reward**.
   - **Route re-ordering:** tickets not served live move their locality to the **front of the driver's next route**, in first-reported-first order. The remaining regular stops follow in their usual order.

## 3. Roles (only two portals)
| Role | Access | Portal |
|------|--------|--------|
| Citizen | No sign-in | User Portal (mobile-first PWA) |
| Driver | Email + password | Driver Portal (mobile-first PWA) |

There is **no admin portal**. Setup (drivers, localities, routes, reward amounts) is done through seed scripts and a config file. Payout export is a CLI script. See `03_ARCHITECTURE.md`.

## 4. Route re-ordering example
Regular route: A -> B -> C -> D.
- Ticket raised in C at 3 PM, then B at 4 PM. Next morning route: **C -> B -> A -> D**.
- Later D raises a ticket. Route becomes: **C -> B -> D -> A**.

Rule: stops with open tickets come first, ordered by the time the earliest open ticket was reported. All other stops follow in their original order.

## 5. Document index
| File | Contents |
|------|----------|
| 01_PROJECT_OVERVIEW.md | This file |
| 02_REQUIREMENTS.md | Functional and non-functional requirements |
| 03_ARCHITECTURE.md | Stack, components, deployment |
| 04_DATABASE_SCHEMA.md | Tables and relations |
| 05_API_SPEC.md | REST endpoints and socket events |
| 06_USER_PORTAL.md | Citizen screens and flow |
| 07_DRIVER_PORTAL.md | Driver screens and flow |
| 08_AI_MODEL_INTEGRATION.md | How the trained model plugs in |
| 09_DISPATCH_AND_ROUTING.md | Geofence pop-ups, assignment, route ordering |
| 10_EDGE_CASES.md | Edge cases and decided handling |
| 11_BUILD_PLAN.md | Phases and rules for the AI agent |
