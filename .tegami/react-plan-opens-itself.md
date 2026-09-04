---
packages:
  "@domainkit/react": minor
---

## The plan lives in its dialog, and connecting opens it

Connecting is the customer saying yes to the records, so `Domain.Flow` plans and opens the review
the moment a connection lands for its domain, and `review="manual"` waits for the trigger instead.
`Connect.Controller.established` counts the connections a surface landed, a token connect or a load
that followed this library's own redirect back, and only ever grows, so the flow acts on a change
rather than a state that fires every render. The return is told from a reload by what the controller
wrote down before navigating away, so no host URL parameter carries it.

The page holds the "Review changes" trigger and the outcome; the operations, the consent sentence,
and the two decisions live in the dialog. Its primary action says what it will do, `Add N records`,
and approves and applies in one pass; a conflict is listed with its reason and the action approves
the rest by operation id, and with nothing addable it is disabled beside what to fix. `Decline` is
the other decision. The dialog closes from the × in its header and from a press outside it, so the
footer carries nothing else. On success it closes, the outcome compound reports the receipt, and
`onApplied` fires.
