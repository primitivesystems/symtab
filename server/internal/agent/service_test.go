package agent

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestDemoTurnPersistsOrderedEventsAndResumesAfterApproval(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	service, err := NewService(db)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	thread, err := service.CreateThread(CreateThreadRequest{
		VaultID:       "vault-1",
		Configuration: Configuration{ProviderID: "demo", Mode: "agent"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartTurn(thread.ID, StartTurnRequest{Prompt: "Build the feature"}); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var sequence int64
	requestID := ""
	completed := false
	for !completed {
		events, err := service.WaitEvents(ctx, thread.ID, sequence)
		if err != nil {
			t.Fatal(err)
		}
		for _, event := range events {
			if event.Sequence != sequence+1 {
				t.Fatalf("event sequence jumped from %d to %d", sequence, event.Sequence)
			}
			sequence = event.Sequence
			if event.Type == "approval.requested" {
				var payload struct {
					RequestID string `json:"requestId"`
				}
				if err := json.Unmarshal(event.Payload, &payload); err != nil {
					t.Fatal(err)
				}
				requestID = payload.RequestID
				if err := service.RespondApproval(thread.ID, requestID, "approve"); err != nil {
					t.Fatal(err)
				}
			}
			completed = completed || event.Type == "turn.completed"
		}
	}
	if requestID == "" {
		t.Fatal("turn completed without requesting approval")
	}
	updated, err := service.Thread(thread.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != "idle" || updated.ActiveTurnID != "" {
		t.Fatalf("thread was not released after completion: %#v", updated)
	}
	if updated.Title != "Build the feature" {
		t.Fatalf("thread was not automatically titled: %q", updated.Title)
	}
}

func TestOpenCodeACPStreamsARealTurn(t *testing.T) {
	if os.Getenv("SYMTAB_TEST_ACP") != "1" {
		t.Skip("set SYMTAB_TEST_ACP=1 to exercise the installed OpenCode provider")
	}
	db, err := gorm.Open(sqlite.Open("file:agent-acp-test?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	root := t.TempDir()
	service, err := NewService(db, func(string) (string, error) { return root, nil })
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	thread, err := service.CreateThread(CreateThreadRequest{
		VaultID: "vault-1", Configuration: Configuration{ProviderID: "opencode", Mode: "agent"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.StartTurn(thread.ID, StartTurnRequest{Prompt: "Do not use tools. Reply exactly SYMTAB_STREAM_OK."}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	var sequence int64
	streamed, completed := false, false
	for !completed {
		events, waitErr := service.WaitEvents(ctx, thread.ID, sequence)
		if waitErr != nil {
			t.Fatal(waitErr)
		}
		for _, event := range events {
			sequence = event.Sequence
			streamed = streamed || event.Type == "message.delta" || event.Type == "reasoning.delta"
			completed = completed || event.Type == "turn.completed"
		}
	}
	if !streamed {
		t.Fatal("provider completed without streaming message or reasoning chunks")
	}
}
