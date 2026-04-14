import { ErrorBoundary } from './app/ErrorBoundary';
import OverviewPage from './app/OverviewPage';

export default function App() {
  return (
    <ErrorBoundary>
      <OverviewPage />
    </ErrorBoundary>
  );
}
