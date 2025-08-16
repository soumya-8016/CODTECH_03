const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
app.use(cors());
app.use(express.json());
app.use(express.static('.'));
const documents = new Map();
const users = new Map();
const documentUsers = new Map();
const defaultDoc = {
    id: 'welcome',
    title: 'Welcome Document',
    content: `// Welcome to Collaborative Coding Platform!
// This is a real-time collaborative editor where multiple users can edit simultaneously.
function welcomeMessage() {
    console.log("Start coding together!");
    
    // Features:
    // ✅ Real-time collaborative editing
    // ✅ Multi-user cursors and selections
    // ✅ Syntax highlighting
    // ✅ Auto-save functionality
    // ✅ User presence indicators
    
    return "Happy coding!";
}
welcomeMessage();`,
    language: 'javascript',
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    version: 1
};
documents.set('welcome', defaultDoc);
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    socket.on('user-join', (userData) => {
        const user = {
            id: socket.id,
            name: userData.name,
            avatar: userData.avatar,
            color: userData.color,
            cursor: null
        };
        users.set(socket.id, user);
        socket.emit('user-registered', user);
        console.log('User registered:', user.name);
    });
    socket.on('join-document', (documentId) => {
        Array.from(socket.rooms).forEach(room => {
            if (room !== socket.id) {
                socket.leave(room);
            }
        });
        socket.join(documentId);
        if (!documentUsers.has(documentId)) {
            documentUsers.set(documentId, new Set());
        }
        documentUsers.get(documentId).add(socket.id);
        const document = documents.get(documentId) || defaultDoc;
        socket.emit('document-loaded', document);
        const usersInDoc = Array.from(documentUsers.get(documentId))
            .map(userId => users.get(userId))
            .filter(Boolean)
            .filter(user => user.id !== socket.id);
        socket.emit('users-in-document', usersInDoc);
        socket.to(documentId).emit('user-joined-document', users.get(socket.id));
        
        console.log(`User ${users.get(socket.id)?.name} joined document ${documentId}`);
    });
    socket.on('text-change', (data) => {
        const { documentId, content, version } = data;
        if (documents.has(documentId)) {
            const doc = documents.get(documentId);
            doc.content = content;
            doc.lastModified = new Date().toISOString();
            doc.version = version;
        }
        socket.to(documentId).emit('text-changed', {
            content,
            version,
            userId: socket.id
        });
    });
    socket.on('cursor-update', (data) => {
        const { documentId, cursor } = data;
        const user = users.get(socket.id);
        if (user) {
            user.cursor = cursor;
            socket.to(documentId).emit('cursor-updated', {
                userId: socket.id,
                cursor,
                user
            });
        }
    });
    socket.on('create-document', (docData) => {
        const newDoc = {
            id: docData.id,
            title: docData.title,
            content: docData.content || '',
            language: docData.language || 'javascript',
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            version: 1
        };
        documents.set(docData.id, newDoc);
        socket.emit('document-created', newDoc);
        console.log('Document created:', newDoc.title);
    });
    socket.on('get-documents', () => {
        const docList = Array.from(documents.values()).map(doc => ({
            id: doc.id,
            title: doc.title,
            language: doc.language,
            lastModified: doc.lastModified
        }));
        socket.emit('documents-list', docList);
    });
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        const user = users.get(socket.id);
        if (user) {
            console.log('User left:', user.name);
        }
        for (const [docId, userSet] of documentUsers.entries()) {
            if (userSet.has(socket.id)) {
                userSet.delete(socket.id);
                socket.to(docId).emit('user-left-document', socket.id);
            }
        }
        users.delete(socket.id);
    });
});
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`🚀 Collaborative Coding Platform server running on port ${PORT}`);
    console.log(`📝 Ready for real-time collaboration!`);
});