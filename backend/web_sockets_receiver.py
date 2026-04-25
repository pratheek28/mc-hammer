import asyncio
import websockets

async def receive_messages():
    async with websockets.connect("ws://127.0.0.1:8765") as websocket:
        message = await websocket.recv()
        print(f"Received message: {message}")

asyncio.run(receive_messages())