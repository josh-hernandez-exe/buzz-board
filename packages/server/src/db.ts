import { okAsync, errAsync, ResultAsync } from "neverthrow";

// const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

type User = { id: string; name: string };

// Imaginary database
const users: User[] = [];
export const db = {
  user: {
    findMany: async () => users,
    findById(id: string): ResultAsync<User, Error> {
      const user = users.find((user) => user.id === id);

      if (user === undefined) {
        return errAsync(new Error("User Not Found"));
      }
      return okAsync(user);
    },
    create: async (data: { name: string }) => {
      const user = { id: String(users.length + 1), ...data };
      users.push(user);
      return user;
    },
  },
};
