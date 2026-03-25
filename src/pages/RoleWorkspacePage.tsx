import { PageHeader } from "../components/ui/PageHeader";

export function RoleWorkspacePage(): JSX.Element {
  return (
    <div className="page">
      <PageHeader
        title="Workspace Under Construction"
        subtitle="REC Manager and Prosumer flows are scaffolded and ready for the next sprint."
      />

      <section className="panel">
        <p>
          This release prioritizes the AI Manager module while keeping shared login, community context,
          top navigation, logs, notifications and account management available for all roles.
        </p>
      </section>
    </div>
  );
}
