"use client";

import { api } from "@autopr/backend/convex/_generated/api";
import { SignInButton, UserButton, useUser } from "@clerk/nextjs";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";

import { ModeToggle } from "@/components/mode-toggle";

export default function Dashboard() {
  const user = useUser();
  const privateData = useQuery(api.privateData.get);

  return (
    <>
      <Authenticated>
        <div className="relative p-6">
          <div className="absolute right-6 top-6">
            <ModeToggle />
          </div>
          <h1>Dashboard</h1>
          <p>Welcome {user.user?.fullName}</p>
          <p>privateData: {privateData?.message}</p>
          <UserButton />
        </div>
      </Authenticated>
      <Unauthenticated>
        <SignInButton />
      </Unauthenticated>
      <AuthLoading>
        <div>Loading...</div>
      </AuthLoading>
    </>
  );
}
