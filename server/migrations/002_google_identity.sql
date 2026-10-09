ALTER TABLE users ADD COLUMN googleSubject TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX users_google_subject ON users(googleSubject) WHERE googleSubject IS NOT NULL;
CREATE UNIQUE INDEX users_google_email ON users(email) WHERE email IS NOT NULL;
