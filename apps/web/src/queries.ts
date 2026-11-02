import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardDetail, Card, MoveCardInput, UpdateCardInput } from '@easy-kanban/shared';
import { api, toast } from './api';

export const useBoards = () => useQuery({ queryKey: ['boards'], queryFn: () => api.listBoards() });
export const useBoard = (id?: string) => useQuery({ queryKey: ['board', id], queryFn: () => api.getBoard(id!), enabled: !!id });
export const useCard = (id?: string | null) => useQuery({ queryKey: ['card', id], queryFn: () => api.getCard(id!), enabled: !!id });
export const useAgents = () => useQuery({ queryKey: ['agents'], queryFn: () => api.listAgents(), refetchInterval: 60_000 });
export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard(), refetchInterval: 60_000 });
export const useNotifications = () => useQuery({ queryKey: ['notifications'], queryFn: () => api.notifications() });
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api.me(), staleTime: Infinity });
export const useLabels = () => useQuery({ queryKey: ['labels'], queryFn: () => api.labels() });

const onError = (e: unknown) => toast('Something went wrong', e instanceof Error ? e.message : String(e));

/** Card update with optimistic patch of the board cache. */
export function useUpdateCard(boardId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCardInput }) => api.updateCard(id, input),
    onMutate: async ({ id, input }) => {
      if (!boardId) return;
      await qc.cancelQueries({ queryKey: ['board', boardId] });
      const prev = qc.getQueryData<BoardDetail>(['board', boardId]);
      if (prev) qc.setQueryData<BoardDetail>(['board', boardId], { ...prev, cards: prev.cards.map((c) => (c.id === id ? ({ ...c, ...input } as Card) : c)) });
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['board', boardId], ctx.prev); onError(e); },
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: ['card', v.id] });
      if (boardId) qc.invalidateQueries({ queryKey: ['board', boardId] });
    },
  });
}

export function useMoveCard(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MoveCardInput }) => api.moveCard(id, input),
    onError,
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: ['board', boardId] });
      qc.invalidateQueries({ queryKey: ['card', v.id] });
    },
  });
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: unknown[][]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
}

export { onError as showError };
