import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { logger } from "@/utils/logger";

export type DropdownOption<T> = { id: string; name: string; data: T };

export function DropDownSelection<T>({
  title,
  options,
  onChange,
}: {
  readonly title: string;
  options: DropdownOption<T>[] | undefined;
  readonly onChange: (item: T) => void;
}) {
  if (!Array.isArray(options)) {
    logger.debug(`Dropdown Selection: No options given.`);
    options = [];
  }

  const [value, setValue] = useState<DropdownOption<T>["id"]>("");

  if (value === "") {
    logger.debug(`Dropdown Selection: Nothing selected`);
  }

  const onValueChange = (id: string) => {
    const [{ name, data }] = options.filter((item) => item.id === id);

    logger.debug(`Dropdown Selection: ${id} (${name})`);

    setValue(id);

    onChange(data);
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
                {item.id}: {item.name}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
