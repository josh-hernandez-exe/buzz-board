"use client";

import { useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/app/_components/ui/select";

import { logger } from "@/logger";

export type DropdownOption<T> = { id: string; name: string; data: T };

export function DropDownSelection<T>({
  title,
  options,
  onChange,
  defaultValue,
}: {
  readonly title: string;
  options: DropdownOption<T>[] | undefined;
  readonly onChange: (item: T) => void;
  defaultValue?: DropdownOption<T>["id"];
}) {
  if (!Array.isArray(options)) {
    logger.debug(`Dropdown Selection: No options given.`);
    options = [];
  }

  const [value, setValue] = useState<DropdownOption<T>["id"]>(
    defaultValue ?? "",
  );

  if (value === "") {
    logger.debug(`Dropdown Selection: Nothing selected`);
  }

  const onValueChange = (id: string) => {
    const selectedItem = options.find((item) => item.id === id);

    if (selectedItem === undefined) {
      logger.error(`Selected item ${id} not found in dropdown`);
      return;
    }

    logger.debug(
      `Dropdown Selection: ${selectedItem.id} (${selectedItem.name})`,
    );

    setValue(selectedItem.id);

    onChange(selectedItem.data);
  };

  logger.debug(options.find((item) => item.id === value)?.name);

  return (
    <Select onValueChange={onValueChange}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder={title} />
      </SelectTrigger>
      <SelectContent className="w-56">
        <SelectGroup>
          <SelectLabel>{title}</SelectLabel>
          {options.map((item) => {
            return (
              <SelectItem value={item.id} key={item.id}>
                {item.name}
              </SelectItem>
            );
          })}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
