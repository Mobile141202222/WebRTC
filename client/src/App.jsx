import { Navigate, Route, Routes } from 'react-router-dom';
import './App.css';
import LandingPage from './pages/LandingPage.jsx';
import RoomPage from './pages/RoomPage.jsx';

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/room/:roomId" element={<RoomPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
