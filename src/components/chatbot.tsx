import React, { useState } from 'react';
interface Message {
  text: string;
  isUser: boolean;
}


// Add type declaration for window.handleDatabaseChange
declare global {
  interface Window {
    handleDatabaseChange?: (database: string) => boolean;
  }
}

const Chatbot: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    // Add user message
    const userMessage: Message = { text: inputText, isUser: true };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInputText('');

    try {
      const response = await fetch(window.location.hostname === "localhost" ? "http://localhost:5051/api/chat" : "/api/chat", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages: updatedMessages }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }
      
      const data = await response.json();
      const flags = data.response.flags;
      console.log('chatbot tsx data: ', data);
      if (flags.databaseChanged.value) {
        window.handleDatabaseChange?.(flags.databaseChanged.database);
      }
      console.log('Response:', data.response);
      
      // Add bot response for normal messages
      const botMessage: Message = { text: data.response.finalText, isUser: false };
      setMessages(prev => [...prev, botMessage]);
    } catch (error) {
      console.error('Error:', error);
      // Add error message
      const errorMessage: Message = { 
        text: 'Sorry, I encountered an error. Please try again.', 
        isUser: false 
      };
      setMessages(prev => [...prev, errorMessage]);
    }
  };

  return (
    <div className="flex flex-col h-[500px] w-full max-w-2xl mx-auto border rounded-lg shadow-lg">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.isUser ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[70%] rounded-lg p-3 ${
                message.isUser
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 text-gray-800'
              }`}
            >
              {message.text}
            </div>
          </div>
        ))}
      </div>

      {/* Input area */}
      <form onSubmit={handleSubmit} className="border-t p-4">
        <div className="flex space-x-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
};

export default Chatbot;
