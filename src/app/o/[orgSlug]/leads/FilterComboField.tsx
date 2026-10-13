"use client";

import { useState } from "react";
import { Combobox, type ComboOption } from "../_shared/Combobox";

/**
 * Bridges the custom Combobox (controlled, React state) into the leads
 * page's plain `<form method="GET">` filter bar (deliberately not a client
 * form -- submission is a normal browser navigation, not fetch). A hidden
 * input carries the real field name/value so the native GET submit picks
 * it up exactly like the native `<select>` it replaces did.
 */
export function FilterComboField({
  name,
  defaultValue,
  options,
  placeholder,
}: {
  name: string;
  defaultValue: string;
  options: ComboOption[];
  placeholder: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Combobox value={value} options={options} onChange={setValue} placeholder={placeholder} />
    </>
  );
}
