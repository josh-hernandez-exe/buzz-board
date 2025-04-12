# Copilot Instructions for Buzz-Board Project

## General Guidelines
1. **Follow the T3 Stack Philosophy**:
   - Keep the project simple and modular.
   - Use TypeScript for type safety and better developer experience.
   - Leverage the power of tRPC, Prisma, and Next.js for full-stack development.

2. **Environment Variables**:
   - Use `.env` files for sensitive data and configuration.
   - Update `/src/env.js` to validate new environment variables.
   - Never commit `.env` files to version control; use `.env.example` as a template.

3. **Code Style**:
   - Use Prettier for consistent formatting (`prettier.config.js`).
   - Follow ESLint rules defined in `eslint.config.js` for linting.
   - Use Tailwind CSS for styling and maintain utility-first CSS practices.

4. **Folder Structure**:
   - Organize components into `client`, `server`, and `ui` folders under `/src/app/_components`.
   - Components (that are not pages) will be split into client components in `/src/app/_components/client` and server components in `/src/app/_components/client`.
   - Place reusable utilities in `/src/utils`
      - note that `/src/app/_lib` is reserved for shadcn UI code.
   - Keep API routes and logic in `/src/server/api`.

5. **Return Styles with neverthrow**:
   - Use `neverthrow`'s `ok` and `err` return styles for functions that can succeed or fail.
   - Avoid using `neverthrow` for React components, tRPC API endpoints, middleware, or middleware context creation.
   - Example of using `neverthrow`:
     ```typescript
     import { ok, err } from "neverthrow";

     function divide(a: number, b: number) {
       if (b === 0) {
         return err(new Error("Division by zero"));
       }
       return ok(a / b);
     }

     const result = divide(10, 2);
     result.match({
       ok: (value) => console.log("Result:", value),
       err: (error) => console.error("Error:", error.message),
     });
     ```

   - Handle `neverthrow` results using `.match()` or `.unwrapOr()` to ensure proper error handling.

## Backend Development
1. **Database**:
   - Use Prisma for database management (`prisma/schema.prisma`).
   - Run migrations with `bun db:migrate` and generate Prisma client with `bun db:generate`.

2. **tRPC**:
   - Define API routers in `/src/server/api/routers`.
   - Use `createTRPCRouter` for modular API design.
   - Leverage `protectedUserProcedure` for authentication and authorization that require user interactions outside of a game context
   - Leverage `protectedGameAdminProcedure` for authentication and authorization that require interactions in a game context that requires a game admin

3. **Authentication**:
   - Use NextAuth.js for user authentication (`/src/server/auth`).
   - Extend session types in `config.ts` for custom properties.


## Frontend Development
1. **React Components**:
   - Use `use client` directive for client-side components.
   - Follow the component structure in `/src/app/_components`.

2. **State Management**:
   - Use React Query (`@tanstack/react-query`) for data fetching and caching. Though most of the time a trpc query should be used.
   - Use `api` from `/src/trpc/react.tsx` for tRPC integration.

3. **Styling**:
   - Use Tailwind CSS for styling (`/src/styles/globals.css`).
   - Follow the design system defined in `components.json`.

## Testing and Debugging
1. **Testing**:
   - Use Storybook for component testing (`*.stories.tsx` files).
   - Write unit tests for critical utilities and components.

2. **Debugging**:
   - Use `tslog` for logging (`/src/utils/logger.ts`).
   - Enable Prisma query logging in development mode (`/src/server/db.ts`).

## Deployment
1. **Docker**:
   - Use the provided `Dockerfile` and `docker-compose` files for containerized deployment.
   - Ensure environment variables are correctly set in production.

2. **Build and Start**:
   - Use `bun build` to build the project.
   - Start the server with `bun start`.

3. **Hosting**:
   - Follow T3 stack deployment guides for Vercel, Netlify, or Docker.

## Additional Notes
- Keep dependencies up-to-date and remove unused packages.
- Document new features and changes in the `README.md`.

By following these best practices, you can maintain a clean, scalable, and efficient codebase for your Buzz-Board project.
