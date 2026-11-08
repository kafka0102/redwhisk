import { lazy, Suspense, type ComponentProps, type JSX } from "react";

const IssueReadOnlyPage = lazy(async () => {
  const module = await import("./issue-detail/issue-read-only-page");
  return { default: module.IssueReadOnlyPage };
});

export function IssuesActivityReadonlySlot({
  loadingLabel,
  ...page
}: ComponentProps<typeof IssueReadOnlyPage> & {
  loadingLabel: string;
}): JSX.Element {
  return (
    <Suspense
      fallback={
        <p className="activity-surface__loading" role="status">
          {loadingLabel}
        </p>
      }
    >
      <IssueReadOnlyPage {...page} />
    </Suspense>
  );
}
