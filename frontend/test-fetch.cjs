fetch('http://localhost:8000/api/timeline')
  .then(res => res.json())
  .then(console.log)
  .catch(console.error);
