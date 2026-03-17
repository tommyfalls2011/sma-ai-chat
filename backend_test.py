import requests
import sys
import json
from datetime import datetime

class SMADevWorkspaceAPITester:
    def __init__(self, base_url="https://ai-dev-workspace-3.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.tests_run = 0
        self.tests_passed = 0
        self.conversation_id = None

    def run_test(self, name, method, endpoint, expected_status, data=None, check_response=None):
        """Run a single API test"""
        url = f"{self.api_url}/{endpoint}" if not endpoint.startswith('http') else endpoint
        headers = {'Content-Type': 'application/json'}

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers)
            elif method == 'PATCH':
                response = requests.patch(url, json=data, headers=headers)

            success = response.status_code == expected_status
            response_data = {}
            
            try:
                response_data = response.json() if response.text else {}
            except:
                response_data = {}

            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                if check_response and callable(check_response):
                    check_success = check_response(response_data)
                    if not check_success:
                        print(f"❌ Response validation failed")
                        self.tests_passed -= 1
                        success = False
                    else:
                        print(f"✅ Response validation passed")
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                if response.text:
                    print(f"   Response: {response.text[:200]}")

            return success, response_data

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_health(self):
        """Test health endpoint"""
        success, response = self.run_test(
            "Health Check",
            "GET",
            "health",
            200,
            check_response=lambda r: r.get("status") == "ok" and "SMA-AI" in r.get("name", "")
        )
        return success

    def test_models(self):
        """Test models endpoint"""
        success, response = self.run_test(
            "List Models",
            "GET", 
            "models",
            200,
            check_response=lambda r: isinstance(r, list) and any(m.get("id") == "claude-opus-4-6" for m in r)
        )
        if success:
            claude_model = next((m for m in response if m.get("id") == "claude-opus-4-6"), None)
            if claude_model:
                print(f"   ✅ Found Claude Opus 4.6: {claude_model.get('name')}")
            else:
                print(f"   ❌ Claude Opus 4.6 not found in models")
                return False
        return success

    def test_create_conversation(self):
        """Test creating a conversation"""
        success, response = self.run_test(
            "Create Conversation",
            "POST",
            "conversations",
            200,
            data={"title": "Test Chat", "model": "claude-opus-4-6"},
            check_response=lambda r: "id" in r and r.get("title") == "Test Chat"
        )
        if success:
            self.conversation_id = response.get("id")
            print(f"   ✅ Created conversation ID: {self.conversation_id}")
        return success

    def test_list_conversations(self):
        """Test listing conversations"""
        success, response = self.run_test(
            "List Conversations",
            "GET",
            "conversations", 
            200,
            check_response=lambda r: isinstance(r, list)
        )
        if success and self.conversation_id:
            conv = next((c for c in response if c.get("id") == self.conversation_id), None)
            if conv:
                print(f"   ✅ Found test conversation in list")
            else:
                print(f"   ❌ Test conversation not found in list")
                return False
        return success

    def test_get_conversation(self):
        """Test getting a specific conversation"""
        if not self.conversation_id:
            print("❌ No conversation ID available for test")
            return False
            
        success, response = self.run_test(
            "Get Conversation by ID",
            "GET",
            f"conversations/{self.conversation_id}",
            200,
            check_response=lambda r: r.get("id") == self.conversation_id and "messages" in r
        )
        return success

    def test_settings_get(self):
        """Test getting settings"""
        success, response = self.run_test(
            "Get Settings",
            "GET",
            "settings",
            200,
            check_response=lambda r: "anthropic_api_key_masked" in r and "ollama_base_url" in r
        )
        if success:
            api_key_masked = response.get("anthropic_api_key_masked", "")
            print(f"   ✅ API Key masked: {api_key_masked}")
        return success

    def test_settings_update(self):
        """Test updating settings"""
        success, response = self.run_test(
            "Update Settings (Ollama URL)",
            "PUT",
            "settings",
            200,
            data={"ollama_base_url": "http://localhost:11434"},
            check_response=lambda r: r.get("ollama_base_url") == "http://localhost:11434"
        )
        return success

    def test_chat_send_short(self):
        """Test chat send with a very short message to minimize API costs"""
        if not self.conversation_id:
            print("❌ No conversation ID available for chat test")
            return False
            
        print(f"🔍 Testing Chat Send (Short message to minimize API costs)...")
        print(f"   URL: {self.api_url}/chat/send")
        
        try:
            # Use a very short prompt as requested
            response = requests.post(
                f"{self.api_url}/chat/send",
                json={
                    "conversation_id": self.conversation_id,
                    "content": "Say hello in 3 words",  # Very short to minimize API costs
                    "model": "claude-opus-4-6"
                },
                headers={'Content-Type': 'application/json'},
                stream=True,
                timeout=30
            )
            
            if response.status_code == 200:
                print(f"✅ Chat stream started - Status: {response.status_code}")
                
                # Read first few chunks to verify streaming works
                content_received = False
                error_received = False
                chunks_read = 0
                
                for line in response.iter_lines():
                    if line and chunks_read < 10:  # Limit to first 10 chunks
                        line_str = line.decode('utf-8')
                        if line_str.startswith('data: '):
                            try:
                                data = json.loads(line_str[6:])
                                if data.get('type') == 'delta' and data.get('content'):
                                    content_received = True
                                    print(f"   ✅ Received streaming content: '{data.get('content')[:20]}...'")
                                elif data.get('type') == 'error':
                                    error_received = True
                                    print(f"   ❌ Received error: {data.get('content')}")
                                elif data.get('type') == 'start':
                                    print(f"   ✅ Stream started with message ID: {data.get('message_id')}")
                            except json.JSONDecodeError:
                                pass
                        chunks_read += 1
                
                self.tests_run += 1
                if content_received and not error_received:
                    self.tests_passed += 1
                    print(f"✅ Chat streaming test passed")
                    return True
                else:
                    print(f"❌ No valid content received or error occurred")
                    return False
            else:
                print(f"❌ Failed - Expected 200, got {response.status_code}")
                if response.text:
                    print(f"   Response: {response.text[:200]}")
                self.tests_run += 1
                return False
                
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.tests_run += 1
            return False

    def test_delete_conversation(self):
        """Test deleting a conversation"""
        if not self.conversation_id:
            print("❌ No conversation ID available for delete test")
            return False
            
        success, response = self.run_test(
            "Delete Conversation",
            "DELETE",
            f"conversations/{self.conversation_id}",
            200,
            check_response=lambda r: r.get("status") == "deleted"
        )
        if success:
            self.conversation_id = None  # Clear the ID since it's deleted
        return success

def main():
    print("🚀 Starting SMA-AI Dev Workspace Backend API Tests")
    print("=" * 60)
    
    tester = SMADevWorkspaceAPITester()
    
    # Run all tests in sequence
    tests = [
        tester.test_health,
        tester.test_models,
        tester.test_settings_get,
        tester.test_settings_update,
        tester.test_create_conversation,
        tester.test_list_conversations, 
        tester.test_get_conversation,
        tester.test_chat_send_short,  # Short message to minimize API costs
        tester.test_delete_conversation,
    ]
    
    failed_tests = []
    for test in tests:
        if not test():
            failed_tests.append(test.__name__)
    
    print("\n" + "=" * 60)
    print(f"📊 Test Results: {tester.tests_passed}/{tester.tests_run} tests passed")
    
    if failed_tests:
        print(f"❌ Failed tests: {', '.join(failed_tests)}")
        return 1
    else:
        print("✅ All tests passed!")
        return 0

if __name__ == "__main__":
    sys.exit(main())