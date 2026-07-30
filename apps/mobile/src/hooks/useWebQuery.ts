import {
  useMutation,
  useQuery,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { WebRequestError, webRequest } from "../api/web";
import { useAuth } from "../auth/AuthProvider";

export function useWebQuery<T>(
  key: readonly unknown[],
  path: string,
  options: Omit<UseQueryOptions<T, Error>, "queryKey" | "queryFn"> = {},
) {
  const { getAccessToken } = useAuth();
  return useQuery<T, Error>({
    queryKey: key,
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in to continue.");
      try {
        return await webRequest<T>(path, token);
      } catch (error) {
        if (!(error instanceof WebRequestError) || error.status !== 401) throw error;
        const refreshed = await getAccessToken(true);
        if (!refreshed) throw error;
        return await webRequest<T>(path, refreshed);
      }
    },
    ...options,
  });
}

export function useWebMutation<TData, TVariables>(
  mutation: (variables: TVariables, token: string) => Promise<TData>,
  options: UseMutationOptions<TData, Error, TVariables> = {},
) {
  const { getAccessToken } = useAuth();
  return useMutation<TData, Error, TVariables>({
    mutationFn: async (variables) => {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in to continue.");
      try {
        return await mutation(variables, token);
      } catch (error) {
        if (!(error instanceof WebRequestError) || error.status !== 401) throw error;
        const refreshed = await getAccessToken(true);
        if (!refreshed) throw error;
        return await mutation(variables, refreshed);
      }
    },
    ...options,
  });
}
