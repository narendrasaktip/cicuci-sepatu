
---
name: shoe-laundry-development
description: Implement and maintain Cicuci Sepatu Management features, including orders, inspections, tracking, payments, and WhatsApp notifications.
---

# Cicuci Sepatu Development Skill

## When to Use
Use this skill when implementing or modifying:
- Customer and order management
- Multi-shoe processing
- Shoe inspection and risk approval
- Laundry status workflows
- Before/after photo documentation
- Customer tracking
- WhatsApp notifications
- Payments and reporting

## Required Context
Before implementing:
1. Read docs/PRD.md.
2. Read docs/BUSINESS_FLOW.md.
3. Review the current Prisma schema.
4. Inspect related frontend and backend modules.
5. Identify affected APIs and existing tests.

## Implementation Workflow

### Step 1: Analyze
- Identify the requested feature.
- Define acceptance criteria.
- Identify database and API changes.
- Check dependencies and edge cases.

### Step 2: Design
- Define data structures.
- Define API request/response contracts.
- Define valid status transitions.
- Identify required UI states.

### Step 3: Implement
- Update database migrations if required.
- Implement backend service logic.
- Add request validation and authorization.
- Implement frontend components.
- Add notification events where applicable.

### Step 4: Test
- Test successful workflows.
- Test invalid status transitions.
- Test unauthorized access.
- Test multi-shoe orders.
- Test WhatsApp delivery failures.
- Verify existing functionality remains intact.

### Step 5: Report
Provide:
- Files changed
- Features implemented
- Tests executed and results
- Known limitations
- Next recommended task

## Critical Scenarios

### Inspection
- Approved shoes can proceed to washing.
- Risky shoes require explicit consent.
- Rejected shoes cannot enter washing.
- Rejected shoes have zero cleaning fees.

### Notifications
- Order updates must succeed even if WhatsApp fails.
- Failed notifications must be retryable.
- Repeated events must not create duplicate messages.

### Tracking
- Public tracking requires a secure token.
- Never expose internal customer records.
- Only display customer-safe order information.
