import { useEffect, useState } from "react";
import { Building2, Home, Search, UserRound, ChevronRight } from "lucide-react";
import {
  readTestAccounts,
  type TestAccount,
  type TestAccountChoice,
} from "../../api/testAccounts";
import { roleLabel } from "../../utils/roles";
import "./TestAccountPicker.css";
const profiles = ["Consumers", "REC Managers", "Other profiles"] as const;
/** A compact directory: profiles first, then the existing community/home context.
 * Shared modal motion and quiet hover states preserve the login's visual theme. */
export function TestAccountPicker({
  onSelect,
}: {
  onSelect: (choice: TestAccountChoice) => void;
}) {
  const [accounts, setAccounts] = useState<TestAccount[] | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const [profile, setProfile] =
      useState<(typeof profiles)[number]>("Consumers"),
    [search, setSearch] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    readTestAccounts(abort.signal)
      .then((data) => {
        if (!abort.signal.aborted) setAccounts(data);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [attempt]);
  const query = search.trim().toLocaleLowerCase();
  const choices = (accounts || [])
    .flatMap((account) =>
      account.contexts.map((context) => ({ account, context })),
    )
    .filter(({ account, context }) => {
      const matches =
        profile === "Consumers"
          ? context.role === "prosumer"
          : profile === "REC Managers"
            ? context.role === "rec_manager"
            : !["prosumer", "rec_manager"].includes(context.role);
      return (
        matches &&
        [
          account.name,
          account.email,
          context.community_name,
          context.site_name,
          roleLabel(context.role),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query)
      );
    });
  const grouped = new Map<string, TestAccountChoice[]>();
  choices.forEach((choice) => {
    const key =
      profile === "Other profiles"
        ? roleLabel(choice.context.role)
        : choice.context.community_name || "Community";
    grouped.set(key, [...(grouped.get(key) || []), choice]);
  });
  return (
    <section className="test-account-directory" aria-label="Test accounts">
      <p>
        Choose an existing account and the community or home you want to
        explore.
      </p>
      <div className="test-profile-tabs" role="group" aria-label="Profiles">
        {profiles.map((name) => (
          <button
            type="button"
            key={name}
            aria-pressed={profile === name}
            onClick={() => setProfile(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <label className="test-account-search">
        <Search size={16} />
        <input
          type="search"
          aria-label="Search test accounts"
          placeholder="Name, community or home…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {!accounts && !error && <p role="status">Loading existing accounts…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="btn"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try again
          </button>
        </div>
      )}
      {accounts && !error && (
        <div className="test-account-groups">
          {[...grouped]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, group]) => (
              <section
                key={name}
                className="test-account-group"
                aria-label={name}
              >
                <h4>
                  {profile === "Other profiles" ? (
                    <UserRound size={15} />
                  ) : (
                    <Building2 size={15} />
                  )}{" "}
                  {name}
                </h4>
                {group
                  .sort((a, b) =>
                    (a.context.site_name || a.account.name).localeCompare(
                      b.context.site_name || b.account.name,
                    ),
                  )
                  .map((choice) => (
                    <button
                      type="button"
                      className="test-account-row"
                      key={[
                        choice.account.id,
                        choice.context.role,
                        choice.context.community_id,
                        choice.context.site_id,
                      ].join(":")}
                      onClick={() => onSelect(choice)}
                    >
                      {profile === "Consumers" ? (
                        <Home size={19} />
                      ) : (
                        <UserRound size={19} />
                      )}
                      <span>
                        <strong>
                          {choice.context.site_name || choice.account.name}
                        </strong>
                        <small>
                          {choice.context.site_name
                            ? `${choice.account.name} · ${choice.context.equipment_count} equipment`
                            : choice.account.email}
                        </small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
              </section>
            ))}
          {choices.length === 0 && (
            <p className="test-account-empty">
              {query
                ? "No matching accounts."
                : profile === "Consumers"
                  ? "No demonstration consumers are associated with a community and home."
                  : "No demonstration accounts for this profile."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
