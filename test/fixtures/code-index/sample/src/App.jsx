import React, { useState, useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import Button from './components/Button';
import Users from './Users';

export default function App() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(1);
  }, []);
  return (
    <Routes>
      <Route path="/users" element={<Users total={count} />} />
    </Routes>
  );
}

export function Toolbar() {
  return <Button label="go" />;
}
