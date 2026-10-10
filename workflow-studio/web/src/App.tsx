import { useSyncExternalStore } from 'react';
import WorkflowList from './pages/WorkflowList';
import Editor from './pages/Editor';
import RunDetail from './pages/RunDetail';
import RunsList from './pages/RunsList';

function currentHash(): string {
  return window.location.hash.replace(/^#/, '') || '/';
}
const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export default function App() {
  const hash = useSyncExternalStore(subscribe, currentHash);
  const pathPart = hash.split('?')[0] || '/';
  const parts = pathPart.split('/').filter(Boolean);

  let page;
  if (parts[0] === 'edit' && parts[1]) page = <Editor workflowId={parts[1]} />;
  else if (parts[0] === 'runs' && parts[1]) page = <RunDetail runId={parts[1]} />;
  else if (parts[0] === 'runs') page = <RunsList />;
  else page = <WorkflowList />;

  return <div className="app">{page}</div>;
}
