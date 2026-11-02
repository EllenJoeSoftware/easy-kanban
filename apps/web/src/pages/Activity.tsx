import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, timeAgo } from '../api';
import { useAgents, useBoards } from '../queries';
import { describe } from '../components/CardModal';
import { Spinner } from '../ui';

export default function ActivityPage() {
  const [boardId, setBoardId] = useState('');
  const [agentId, setAgentId] = useState('');
  const { data: boards } = useBoards();
  const { data: agents } = useAgents();
  const navigate = useNavigate();
  const q = useInfiniteQuery({
    queryKey: ['activity', 'feed', boardId, agentId],
    queryFn: ({ pageParam }) => api.activity({ boardId: boardId || undefined, agentId: agentId || undefined, limit: 50, before: pageParam || undefined }),
    initialPageParam: '',
    getNextPageParam: (last) => (last.length === 50 ? last[last.length - 1].createdAt : undefined),
  });
  const items = q.data?.pages.flat() ?? [];
  return (
    <div className="page">
      <div className="filter-bar">
        <select value={boardId} onChange={(e) => setBoardId(e.target.value)}>
          <option value="">All boards</option>
          {boards?.map((b) => <option key={b.id} value={b.id}>{b.icon} {b.name}</option>)}
        </select>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          <option value="">Everyone</option>
          {agents?.map((a) => <option key={a.id} value={a.id}>{a.avatar} {a.name}</option>)}
        </select>
      </div>
      <section className="panel">
        {q.isLoading && <div className="center pad"><Spinner /></div>}
        <ul className="feed">
          {items.map((a) => (
            <li key={a.id} className={a.cardId ? 'clickable' : ''} onClick={() => a.boardId && a.cardId && navigate(`/b/${a.boardId}?card=${a.cardId}`)}>
              <span className={`feed-dot actor-${a.actor.type}`} />
              <div><b>{a.actor.name}</b> {describe(a.action, a.data)}</div>
              <span className="muted xsmall nowrap" title={new Date(a.createdAt).toLocaleString()}>{timeAgo(a.createdAt)}</span>
            </li>
          ))}
        </ul>
        {q.hasNextPage && <button className="btn ghost block" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>Load more</button>}
        {!q.isLoading && !items.length && <div className="muted center pad">No activity.</div>}
      </section>
    </div>
  );
}
