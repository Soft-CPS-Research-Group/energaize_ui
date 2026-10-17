import { useSyncExternalStore } from "react";

const CHANGE_EVENT = "energaize-profile-photo";
const keyFor = (email: string) => `energaize_profile_photo:${email.trim().toLowerCase()}`;

export function readProfilePhoto(email: string): string | null {
  try { return email ? localStorage.getItem(keyFor(email)) : null; }
  catch { return null; }
}

export function saveProfilePhoto(email: string, photo: string): void {
  if (!email) return;
  localStorage.setItem(keyFor(email), photo);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useProfilePhoto(email: string) {
  return useSyncExternalStore(subscribe, () => readProfilePhoto(email), () => null);
}

export async function prepareProfilePhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPG, PNG or WebP image.");
  }
  if (file.size > 8 * 1024 * 1024) throw new Error("Choose an image smaller than 8 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 320;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare this image.");
    const size = Math.min(image.naturalWidth, image.naturalHeight);
    context.fillStyle = "#f4f1eb";
    context.fillRect(0, 0, 320, 320);
    context.drawImage(image, (image.naturalWidth-size)/2, (image.naturalHeight-size)/2, size, size, 0, 0, 320, 320);
    return canvas.toDataURL("image/jpeg", .86);
  } finally { URL.revokeObjectURL(url); }
}
