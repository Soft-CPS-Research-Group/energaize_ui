import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfileAvatar } from "./ProfileAvatar";
import { prepareProfilePhoto, readProfilePhoto, saveProfilePhoto } from "../../hooks/useProfilePhoto";
import type { Session } from "../../types";

const session: Session = { name: "Ana Silva", email: "ana@example.com", role: "training_manager", remember: true };

describe("shared profile photo", () => {
  it("updates all avatars, persists across mounts and isolates users", () => {
    const first = render(<><ProfileAvatar session={session} /><ProfileAvatar session={session} size="large" /></>);
    act(() => saveProfilePhoto(" ANA@example.com ", "data:image/jpeg;base64,photo"));
    expect(screen.getAllByRole("img", { name: "Ana Silva" })).toHaveLength(2);
    screen.getAllByRole("img").forEach(image => expect(image).toHaveAttribute("src", "data:image/jpeg;base64,photo"));
    expect(readProfilePhoto("other@example.com")).toBeNull();
    first.unmount();
    render(<ProfileAvatar session={session} />);
    expect(screen.getByRole("img")).toHaveAttribute("src", "data:image/jpeg;base64,photo");
  });

  it("falls back on failure and remembers removal instead of restoring the default photo", () => {
    const first = render(<ProfileAvatar session={session} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("AS")).toBeInTheDocument();
    act(() => saveProfilePhoto(session.email, "data:image/jpeg;base64,new"));
    expect(screen.getByRole("img")).toBeInTheDocument();
    act(() => saveProfilePhoto(session.email, ""));
    first.unmount();
    render(<ProfileAvatar session={session} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("AS")).toBeInTheDocument();
  });

  it("rejects unsupported and oversized uploads before decoding", async () => {
    await expect(prepareProfilePhoto(new File(["invalid"], "avatar.svg", { type: "image/svg+xml" }))).rejects.toThrow("JPG, PNG or WebP");
    await expect(prepareProfilePhoto(new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }))).rejects.toThrow("8 MB");
  });
});
