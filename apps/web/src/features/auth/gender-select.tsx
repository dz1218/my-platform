"use client";

import { Select } from "@/components/select";
import type { Gender } from "@/types/companion";

const options = [
  { value: "FEMALE", label: "女" },
  { value: "MALE", label: "男" },
];

export function GenderSelect({
  id = "register-gender",
  describedBy = "register-gender-help",
  value,
  onChange,
  disabled = false,
}: {
  id?: string;
  describedBy?: string;
  value: Gender | "";
  onChange: (value: Gender) => void;
  disabled?: boolean;
}) {
  return <Select id={id} label="性别" name="gender" required options={options}
    value={value} disabled={disabled} describedBy={describedBy}
    placeholder="请选择性别" requiredMessage="请选择性别。"
    onChange={value => onChange(value as Gender)} />;
}
