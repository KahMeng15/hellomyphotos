CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    password_hash TEXT NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'user', 'viewer')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE user_folder_access (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    folder_path TEXT NOT NULL,
    PRIMARY KEY (user_id, folder_path)
);

-- Automatically create default admin user
INSERT INTO users (email, name, password_hash, role) 
VALUES ('admin@example.com', 'Admin', '$2b$10$6RA2zF7AVoZaXO/Wj126ROvtJnVNecG4dvJRW9Sinw1HHUV1SlWYa', 'admin')
ON CONFLICT (email) DO NOTHING;
