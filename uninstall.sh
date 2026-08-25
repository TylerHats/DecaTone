#!/bin/bash
# DecaTone Docker Uninstallation Script
set -e

echo "===================================================="
echo " ⚠️  DecaTone Telephone Switch Uninstaller"
echo "===================================================="

read -p "Are you sure you want to stop DecaTone and remove containers? (y/N): " CONFIRM
if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
    if docker compose version &> /dev/null; then
        docker compose down
    else
        docker-compose down
    fi
    echo "DecaTone containers stopped."
    
    read -p "Do you also want to permanently delete persistent data volumes (database, voicemails, branding)? (y/N): " PURGE
    if [[ "$PURGE" =~ ^[Yy]$ ]]; then
        docker volume rm decatone_decatone-data decatone_decatone-uploads 2>/dev/null || true
        echo "Persistent data volumes removed."
    fi
    echo "Uninstallation complete."
else
    echo "Cancelled."
fi
