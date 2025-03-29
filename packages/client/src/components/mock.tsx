import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import { useState } from "react";

import { trpc } from "../utils/trpc";
import { logger } from "../utils/logger";

function SearchUserComponent({ userId }: { userId: string }) {
  if (!userId) {
    return <p>No user given.</p>;
  }

  const user = trpc.user.byId.useQuery(userId);

  let result = user?.data?.name;
  if (result === null || result === undefined) {
    result = "(No user found.)";
  }

  return <p>Look Up User: {result}</p>;
}

export function MockComponent() {
  const utils = trpc.useUtils();
  const [name, setName] = useState<string>("");
  const [userIdToLookUp, setUserIdToLookUp] = useState<string>("");
  const userQuery = trpc.user.list.useQuery();

  const mutation = trpc.user.create.useMutation({
    onSuccess() {
      utils.user.list.invalidate();
    },
  });

  const addUser = () => {
    if (name !== "") {
      logger.debug(name);
      mutation.mutate({ name });
      utils.user.list.invalidate();
    }
  };
  return (
    <div>
      <p>Hello</p>
      <p>Users: {userQuery.data?.map((u) => u?.name).join(", ")}</p>
      <div className="flex w-full max-w-sm items-center space-x-2">
        <Input
          type="Create User"
          placeholder="User"
          onChange={(e) => setName(e.target.value)}
          value={name}
        />
        <Button type="submit" onClick={addUser} disabled={mutation.isPending}>
          Create
        </Button>
      </div>
      <div className="flex w-full max-w-sm items-center space-x-2">
        <SearchUserComponent userId={userIdToLookUp} />
        <Input
          type="number"
          placeholder="User"
          onChange={(e) => setUserIdToLookUp(e.target.value)}
          value={userIdToLookUp}
        />
      </div>
    </div>
  );
}
