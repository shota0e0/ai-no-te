export const REVIEW_STATES = Object.freeze({
  pending: "PENDING_REVIEW",
  approved: "APPROVED",
});

export function createPendingReview(fixture) {
  return Object.freeze({
    fixtureId: fixture.metadata.fixtureId,
    state: REVIEW_STATES.pending,
    humanDecision: null,
  });
}

export function recordHumanApproval(review, { reviewer, confirmed } = {}) {
  if (review?.state !== REVIEW_STATES.pending) {
    throw new Error("Only a pending review can be approved");
  }
  if (confirmed !== true || typeof reviewer !== "string" || reviewer.trim() === "") {
    throw new Error("Explicit human confirmation and reviewer label are required");
  }
  return Object.freeze({
    ...review,
    state: REVIEW_STATES.approved,
    humanDecision: Object.freeze({ reviewer: reviewer.trim(), decision: "approve" }),
  });
}
