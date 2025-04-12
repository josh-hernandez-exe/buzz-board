import NextAuth from "next-auth";
import { cache } from "react";

import { authConfig } from "./config";
import { gameAuth } from "./game";

const { auth: uncachedAuth, handlers, signIn, signOut } = NextAuth(authConfig);

const auth = cache(uncachedAuth);

export { auth, handlers, signIn, signOut, gameAuth };
