"use client";

import { useState } from "react";

import { Button } from "@/app/_components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/_components/ui/dropdown-menu";

import { logger } from "@/utils/logger";

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

  const [value, setValue] = useState<DropdownOption<T>["id"]>(defaultValue || "");

  if (value === "") {
    logger.debug(`Dropdown Selection: Nothing selected`);
  }

  const onValueChange = (id: string) => {
    const [selectedItem] = options.filter((item) => item.id === id);

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">{title}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
          {options.map((item) => {
            return (
              <DropdownMenuRadioItem value={item.id} key={item.id}>
                {item.name}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
