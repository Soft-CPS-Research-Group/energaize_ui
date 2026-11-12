import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { MultiSelect } from "./MultiSelect";

function Harness() {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <MultiSelect
      options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]}
      selected={selected}
      onChange={setSelected}
      placeholder="Select buildings…"
    />
  );
}

describe("MultiSelect", () => {
  it("selects options through real checkboxes and shows removable chips", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Select buildings…" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
    expect(screen.getByRole("button", { name: "1 selected" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove Alpha" }));
    expect(screen.getByRole("button", { name: "Select buildings…" })).toBeInTheDocument();
  });

  it("selects everything at once and closes with Escape", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Select buildings…" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByRole("button", { name: "All selected" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("checkbox", { name: "Alpha" })).not.toBeInTheDocument();
  });
});
