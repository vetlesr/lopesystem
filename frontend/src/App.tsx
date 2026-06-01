import { BrowserRouter, Routes, Route } from 'react-router-dom'
import RaceList from './pages/RaceList'
import LiveDashboard from './pages/LiveDashboard'
import ParticipantEditor from './pages/ParticipantEditor'
import LoopOverview from './pages/LoopOverview'
import Scoreboard from './pages/Scoreboard'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Startside – oversikt over alle løp */}
        <Route path="/" element={<RaceList />} />

        {/* Under et aktivt løp – 4 sider */}
        <Route path="/race/:id" element={<LiveDashboard />} />
        <Route path="/race/:id/edit" element={<ParticipantEditor />} />
        <Route path="/race/:id/loops" element={<LoopOverview />} />
        <Route path="/race/:id/scoreboard" element={<Scoreboard />} />

        {/* Bakoverkompatibilitet med gammel URL */}
        <Route path="/race/:id/participants" element={<ParticipantEditor />} />
      </Routes>
    </BrowserRouter>
  )
}
