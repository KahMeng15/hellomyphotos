const fs = require('fs');
let content = fs.readFileSync('frontend/src/lib/components/Lightbox.svelte', 'utf8');

content = content.replace(/\.album-info\s*\{[\s\S]*?\}/, `.album-info {
    display: flex;
    gap: 12px;
    align-items: center;
  }`);

content = content.replace(/\.album-cover\s*\{[\s\S]*?\}/, `.album-cover {
    width: 80px;
    height: 80px;
    border-radius: 0;
    overflow: hidden;
    flex-shrink: 0;
    background: rgba(255,255,255,0.05);
    transition: filter 0.2s ease;
  }
  
  .album-cover:hover {
    filter: brightness(1.2);
  }`);

content = content.replace(/\.album-name\s*\{[\s\S]*?\}/, `.album-name {
    color: inherit;
    text-decoration: none;
    font-weight: 500;
    display: block;
    font-size: 0.875rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .album-name:hover {
    text-decoration: underline;
  }`);

content = content.replace(/\.face-list\s*\{[\s\S]*?\}/, `.face-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }`);

content = content.replace(/\.face-item\s*\{[\s\S]*?\}/, `.face-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    text-decoration: none;
    color: inherit;
    width: 80px;
  }`);

content = content.replace(/\.face-avatar\s*\{[\s\S]*?\}/, `.face-avatar {
    width: 80px;
    height: 80px;
    border-radius: 0;
    overflow: hidden;
    display: block;
    background: rgba(255,255,255,0.05);
    transition: filter 0.2s ease;
  }`);

content = content.replace(/\.face-item:hover \.face-avatar\s*\{[\s\S]*?\}/, `.face-item:hover .face-avatar {
    filter: brightness(1.2);
  }`);

content = content.replace(/\.face-item-name\s*\{[\s\S]*?\}/, `.face-item-name {
    font-size: 0.75rem;
    color: #e2e8f0;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }`);

fs.writeFileSync('frontend/src/lib/components/Lightbox.svelte', content, 'utf8');
