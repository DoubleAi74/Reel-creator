"use client";

import { useEffect, useRef } from "react";

// Textarea that starts one line tall and grows to fit its content.
export function AutoGrowTextarea({ className = "", onChange, value, ...props }) {
  const ref = useRef(null);

  useEffect(() => {
    const element = ref.current;

    if (element) {
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    }
  }, [value]);

  return (
    <textarea
      className={className}
      onChange={onChange}
      ref={ref}
      rows={1}
      style={{ overflow: "hidden", resize: "none" }}
      value={value}
      {...props}
    />
  );
}
