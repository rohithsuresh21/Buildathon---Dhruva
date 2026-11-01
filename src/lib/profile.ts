"use client";

import { useCallback, useEffect, useState } from "react";

/** The optional sender profile. It lives only in this browser's localStorage and pre-fills bookings. */
export interface Profile {
  name: string;
  email: string;
  phone: string;
}

const KEY = "dhruva.profile.v1";
const SKIP = "dhruva.profile.skipped.v1";
const empty: Profile = { name: "", email: "", phone: "" };

function read(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...empty, ...JSON.parse(raw) } : empty;
  } catch {
    return empty;
  }
}

export function useProfile() {
  const [profile, setProfile] = useState<Profile>(empty);
  useEffect(() => {
    setProfile(read());
    const on = () => setProfile(read());
    window.addEventListener("dhruva:profile", on);
    return () => window.removeEventListener("dhruva:profile", on);
  }, []);
  const save = useCallback((p: Profile) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* storage blocked */
    }
    setProfile(p);
    window.dispatchEvent(new Event("dhruva:profile"));
  }, []);
  return { profile, save };
}

export const profileSkipped = () => {
  try {
    return !!localStorage.getItem(SKIP) || !!localStorage.getItem(KEY);
  } catch {
    return true;
  }
};
export const markProfileSkipped = () => {
  try {
    localStorage.setItem(SKIP, "1");
  } catch {
    /* storage blocked */
  }
};
