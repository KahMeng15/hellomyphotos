const fs = require('fs');
// run via fetch to backend api
fetch('http://localhost:8000/api/media')
  .then(res => res.json())
  .then(data => {
     const file = data.find(f => f.file_name.includes('DSC08282.jpg'));
     console.log(JSON.stringify(file.exif_json, null, 2));
  })
  .catch(console.error);
